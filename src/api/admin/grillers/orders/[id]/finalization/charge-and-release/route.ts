import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_CHARGE_ATTEMPTING,
  FINALIZATION_CHARGE_FAILED_HOLD,
  FINALIZATION_CHARGED_READY_TO_SHIP,
  FINALIZATION_PACKED_PENDING_CHARGE,
  appendStaffAudit,
  assertStripeFinalPaymentIntentSucceeded,
  createStripeFinalPaymentIntent,
  finalChargeOrderMetadata,
  finalChargeSucceeded,
  isInvoiceOrder,
  metadataObject,
  previewFinalization,
  recordFinalChargeAttempt,
} from "../../../../../../../lib/catch-weight-finalization"
import {
  emitFinalizationRouteFailureAlert,
  jsonError,
  retrieveFinalizationOrder,
  staffAuditActorId,
  staffAuditFields,
} from "../utils"
import {
  bookWwexFinalizationShipment,
  quoteWwexFinalizationShipping,
} from "../../../../../../../lib/wwex-finalization-shipment"
import {
  emitChargeFailedHoldAlert,
  emitChargeMarkedReadyButPiNotSucceededAlert,
  emitFinalChargeNonSucceededAlert,
} from "../../../../../../../lib/final-charge-ops-alerts"

type ChargeBody = {
  idempotency_key?: string
  staff_actor_customer_id?: string
  staff_actor_email?: string
  staff_actor_name?: string
}

const stripeChargeId = (paymentIntent: {
  latest_charge?: string | null
  charges?: { data?: Array<{ id?: string }> }
}) => paymentIntent.latest_charge || paymentIntent.charges?.data?.[0]?.id || null

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  // #283: invoice (A/R) orders are never card-charged. Refuse before any card-status logic so an
  // invoice order is neither stranded in nor accidentally routed through the card-charge path.
  if (isInvoiceOrder(order)) {
    return jsonError(
      res,
      409,
      "This is a pay-by-invoice order. It bills to accounts receivable and is not charged to a card; it releases to fulfillment once packed.",
    )
  }

  if (finalChargeSucceeded(order)) {
    return res.status(200).json({
      already_charged: true,
      order,
      metadata: metadataObject(order.metadata),
    })
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body || {}) as ChargeBody
  const staffAudit = staffAuditFields(req, body)
  const staffActor = staffAuditActorId(staffAudit)
  let preview: Awaited<ReturnType<typeof previewFinalization>>
  let wwexQuote: Awaited<ReturnType<typeof quoteWwexFinalizationShipping>>
  let effectiveTotals: Record<string, any>
  let finalOrderTotal: number
  let idempotencyKey: string

  try {
    preview = await previewFinalization(db, order, { persist: true })

    if (preview.errors.length) {
      return jsonError(res, 409, "Finalization has unresolved line errors.", {
        errors: preview.errors,
      })
    }

    if (
      preview.finalization.status !== FINALIZATION_PACKED_PENDING_CHARGE &&
      preview.finalization.status !== FINALIZATION_CHARGE_FAILED_HOLD
    ) {
      return jsonError(
        res,
        409,
        "Order must be approved before the final charge can be attempted.",
        { status: preview.finalization.status }
      )
    }

    if (!preview.payment_setup?.stripe_payment_method_id) {
      return jsonError(res, 409, "Order does not have a saved Stripe card.")
    }

    if (!preview.payment_setup?.stripe_customer_id) {
      return jsonError(res, 409, "Order does not have a Stripe customer id.")
    }

    wwexQuote = await quoteWwexFinalizationShipping({
      order,
      preview,
      logger,
    })
    effectiveTotals = wwexQuote?.totals || preview.totals

    finalOrderTotal = effectiveTotals.final_order_total
    if (finalOrderTotal === null || finalOrderTotal === undefined) {
      return jsonError(
        res,
        409,
        "Final order total is not available until all catch-weight lines are complete."
      )
    }

    idempotencyKey =
      body.idempotency_key ||
      `final-charge:${order.id}:${preview.finalization.id}:${randomUUID()}`

    await db("gp_order_finalization")
      .where({ id: preview.finalization.id })
      .update({
        status: FINALIZATION_CHARGE_ATTEMPTING,
        charge_attempted_at: new Date(),
        charged_by: staffActor,
        updated_at: new Date(),
      })
  } catch (error) {
    await emitFinalizationRouteFailureAlert({
      req,
      action: "charge_and_release_preflight",
      error,
      order,
      orderId: req.params.id,
      path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
      status: 409,
    })
    return jsonError(
      res,
      409,
      error instanceof Error
        ? error.message
        : "Could not prepare the final charge."
    )
  }

  try {
    const paymentIntent = await createStripeFinalPaymentIntent({
      amount: finalOrderTotal,
      currencyCode: preview.finalization.currency_code || order.currency_code || "usd",
      stripeCustomerId: preview.payment_setup.stripe_customer_id,
      stripePaymentMethodId: preview.payment_setup.stripe_payment_method_id,
      idempotencyKey,
      orderId: order.id,
      finalizationId: preview.finalization.id,
      displayId: (order as any).display_id ? String((order as any).display_id) : null,
    })
    if (paymentIntent.status && paymentIntent.status !== "succeeded") {
      // #251: non-succeeded Stripe intents must be visible before the assert trips.
      await emitFinalChargeNonSucceededAlert({
        logger,
        orderId: order.id,
        finalizationId: preview.finalization.id,
        paymentIntentId: paymentIntent.id,
        paymentIntentStatus: paymentIntent.status,
        amount: finalOrderTotal,
      })
      // MONEY-CRITICAL guard (Section A): the order is about to be marked
      // charged_ready_to_ship (lifts fulfillment gate + queues QBD invoice +
      // emails customer) but the PaymentIntent has NOT settled. The existing
      // assert below ALWAYS blocks this transition by throwing, so the behavior
      // here is already "blocked". GRILLERS_BLOCK_NONSUCCEEDED_CHARGE (default
      // false) exists for the inverse, opt-in scenario where the assert is ever
      // relaxed: if set true it forces the block to remain; if false and the
      // assert were ever removed, this would degrade to alert-only. We do NOT
      // change control flow here beyond the alert — the assert is the gate.
      const blockNonSucceeded =
        process.env.GRILLERS_BLOCK_NONSUCCEEDED_CHARGE === "true"
      // The assert below trips unconditionally, so the transition is blocked
      // regardless of the flag. `assertEnforcesBlock` documents that; the flag
      // is folded in so the reported value stays accurate if the assert is ever
      // relaxed in favor of the opt-in flag.
      const assertEnforcesBlock = true
      await emitChargeMarkedReadyButPiNotSucceededAlert({
        logger,
        orderId: order.id,
        finalizationId: preview.finalization.id,
        paymentIntentId: paymentIntent.id,
        paymentIntentStatus: paymentIntent.status,
        amount: finalOrderTotal,
        blocked: assertEnforcesBlock || blockNonSucceeded,
      })
    }
    assertStripeFinalPaymentIntentSucceeded(paymentIntent)
    const chargeId = stripeChargeId(paymentIntent)
    const attempt = await recordFinalChargeAttempt(db, {
      orderId: order.id,
      finalizationId: preview.finalization.id,
      amount: finalOrderTotal,
      currencyCode: preview.finalization.currency_code || order.currency_code || "usd",
      stripeCustomerId: preview.payment_setup.stripe_customer_id,
      stripePaymentMethodId: preview.payment_setup.stripe_payment_method_id,
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: chargeId,
      stripeStatus: paymentIntent.status || null,
      status: "succeeded",
      idempotencyKey,
      requestedBy: staffActor,
    })

    const finalizationForMetadata = {
      ...preview.finalization,
      ...effectiveTotals,
      status: FINALIZATION_CHARGED_READY_TO_SHIP,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: chargeId,
    }

    const wwexBooking = await bookWwexFinalizationShipment({
      order,
      quote: wwexQuote,
      logger,
    })

    await db("gp_order_finalization")
      .where({ id: preview.finalization.id })
      .update({
        ...effectiveTotals,
        status: FINALIZATION_CHARGED_READY_TO_SHIP,
        charged_at: new Date(),
        charged_by: staffActor,
        charge_attempt_id: attempt.id,
        released_at: new Date(),
        released_by: staffActor,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_charge_id: chargeId,
        stripe_failure_code: null,
        stripe_failure_message: null,
        qbd_posting_required: true,
        qbd_posting_status: "pending_manual",
        qbd_posting_action: "final_card_charge_accounting_record",
        qbd_posting_request_key: `final_charge:${paymentIntent.id}`,
        metadata: {
          ...metadataObject(preview.finalization.metadata),
          ...(wwexQuote?.metadata || {}),
          ...(wwexBooking.metadata || {}),
        },
        updated_at: new Date(),
      })

    const existingTransactions = await orderModule.listOrderTransactions(
      {
        order_id: order.id,
        reference: "final_charge",
        reference_id: paymentIntent.id,
      },
      { select: ["id"] }
    )

    if (!existingTransactions.length) {
      await orderModule.addOrderTransactions({
        order_id: order.id,
        amount: finalOrderTotal,
        currency_code:
          preview.finalization.currency_code || order.currency_code || "usd",
        reference: "final_charge",
        reference_id: paymentIntent.id,
      })
    }

    const metadata = {
      ...finalChargeOrderMetadata({
        order,
        finalization: finalizationForMetadata,
        paymentIntent,
        attemptId: attempt.id,
        actorId: staffActor,
        staffAudit,
      }),
      ...(wwexQuote?.metadata || {}),
      ...(wwexBooking.metadata || {}),
      catch_weight_final_lines: preview.lines.map((line: Record<string, any>) => ({
        line_item_id: line.line_item_id,
        product_id: line.product_id,
        variant_id: line.variant_id,
        customer_title: line.customer_title || null,
        title_snapshot: line.title_snapshot || null,
        sku: line.sku,
        qbd_list_id: line.replacement_qbd_list_id || line.qbd_list_id,
        pricing_mode: line.pricing_mode,
        ordered_quantity: line.ordered_quantity,
        actual_quantity: line.actual_quantity,
        actual_piece_count: line.actual_piece_count,
        actual_weight_total: line.actual_weight_total,
        actual_unit_price: line.actual_unit_price || line.unit_price,
        final_line_subtotal: line.final_line_subtotal,
        final_line_total: line.final_line_total,
        delta_line_total: line.delta_line_total,
        status: line.status,
        note: line.note || null,
        replacement_variant_id: line.replacement_variant_id || null,
        replacement_qbd_list_id: line.replacement_qbd_list_id || null,
        replacement_reason: line.replacement_reason || null,
        short_reason: line.short_reason || null,
        metadata: line.metadata || null,
        staff_added_line:
          metadataObject(line.metadata).staff_added_line === true || false,
      })),
      catch_weight_packages: preview.packages || [],
    }

    await orderModule.updateOrders(order.id, { metadata })
    await eventBus.emit({
      name: "order.final_charge_succeeded",
      data: {
        id: order.id,
        order_id: order.id,
        finalization_id: preview.finalization.id,
        payment_intent_id: paymentIntent.id,
        amount: finalOrderTotal,
        currency_code:
          preview.finalization.currency_code || order.currency_code || "usd",
      },
    })

    res.status(200).json({
      order,
      finalization: finalizationForMetadata,
      lines: preview.lines,
      package_capture_required: preview.package_capture_required,
      packages: preview.packages,
      payment_setup: preview.payment_setup,
      charge_attempt: attempt,
      payment_intent: {
        id: paymentIntent.id,
        status: paymentIntent.status,
        latest_charge: chargeId,
      },
      metadata,
    })
  } catch (error) {
    const stripeError = (error as any)?.stripe_error || {}
    const failureMessage =
      error instanceof Error ? error.message : "Stripe final charge failed."
    const attempt = await recordFinalChargeAttempt(db, {
      orderId: order.id,
      finalizationId: preview.finalization.id,
      amount: finalOrderTotal,
      currencyCode: preview.finalization.currency_code || order.currency_code || "usd",
      stripeCustomerId: preview.payment_setup.stripe_customer_id,
      stripePaymentMethodId: preview.payment_setup.stripe_payment_method_id,
      stripePaymentIntentId: stripeError.payment_intent?.id || null,
      stripeStatus: stripeError.payment_intent?.status || null,
      status: "failed",
      failureCode: stripeError.code || null,
      failureMessage,
      idempotencyKey,
      requestedBy: staffActor,
    })
    const metadata = appendStaffAudit(
      {
        ...metadataObject(order.metadata),
        finalization_id: preview.finalization.id,
        finalization_status: FINALIZATION_CHARGE_FAILED_HOLD,
        catch_weight_status: FINALIZATION_CHARGE_FAILED_HOLD,
        final_charge_status: "failed",
        final_charge_failed_at: new Date().toISOString(),
        fulfillment_gate_status: "blocked_charge_failed",
        stripe_failure_code: stripeError.code || null,
        stripe_failure_message: failureMessage,
      },
      {
        action: "final_charge_failed",
        status: FINALIZATION_CHARGE_FAILED_HOLD,
        charge_attempt_id: attempt.id,
        ...staffAudit,
        failure_code: stripeError.code || null,
        failure_message: failureMessage,
      }
    )

    await db("gp_order_finalization")
      .where({ id: preview.finalization.id })
      .update({
        status: FINALIZATION_CHARGE_FAILED_HOLD,
        charge_attempt_id: attempt.id,
        stripe_failure_code: stripeError.code || null,
        stripe_failure_message: failureMessage,
        blocked_reason: "stripe_final_charge_failed",
        updated_at: new Date(),
      })
    await orderModule.updateOrders(order.id, { metadata })
    // #251: every charge_failed_hold entry must emit an ops alert.
    await emitChargeFailedHoldAlert({
      logger,
      orderId: order.id,
      finalizationId: preview.finalization.id,
      chargeAttemptId: attempt.id,
      paymentIntentId: stripeError.payment_intent?.id || null,
      paymentIntentStatus: stripeError.payment_intent?.status || null,
      failureCode: stripeError.code || null,
      failureMessage,
    })

    res.status(402).json({
      message: failureMessage,
      finalization_status: FINALIZATION_CHARGE_FAILED_HOLD,
      charge_attempt: attempt,
    })
  }
}
