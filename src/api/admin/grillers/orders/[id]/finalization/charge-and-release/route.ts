import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_CHARGE_ATTEMPTING,
  FINALIZATION_CHARGE_FAILED_HOLD,
  FINALIZATION_CHARGED_READY_TO_SHIP,
  FINALIZATION_PACKED_PENDING_CHARGE,
  appendStaffAudit,
  createStripeFinalPaymentIntent,
  finalChargeOrderMetadata,
  finalChargeSucceeded,
  metadataObject,
  previewFinalization,
  recordFinalChargeAttempt,
} from "../../../../../../../lib/catch-weight-finalization"
import { actorId, jsonError, retrieveFinalizationOrder } from "../utils"

type ChargeBody = {
  idempotency_key?: string
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
  const body = (req.body || {}) as ChargeBody
  const staffActor = actorId(req)
  const preview = await previewFinalization(db, order, { persist: true })

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

  const idempotencyKey =
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

  try {
    const paymentIntent = await createStripeFinalPaymentIntent({
      amount: preview.totals.final_order_total,
      currencyCode: preview.finalization.currency_code || order.currency_code || "usd",
      stripeCustomerId: preview.payment_setup.stripe_customer_id,
      stripePaymentMethodId: preview.payment_setup.stripe_payment_method_id,
      idempotencyKey,
      orderId: order.id,
      finalizationId: preview.finalization.id,
      displayId: (order as any).display_id ? String((order as any).display_id) : null,
    })
    const chargeId = stripeChargeId(paymentIntent)
    const attempt = await recordFinalChargeAttempt(db, {
      orderId: order.id,
      finalizationId: preview.finalization.id,
      amount: preview.totals.final_order_total,
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
      ...preview.totals,
      status: FINALIZATION_CHARGED_READY_TO_SHIP,
      stripe_payment_intent_id: paymentIntent.id,
      stripe_charge_id: chargeId,
    }

    await db("gp_order_finalization")
      .where({ id: preview.finalization.id })
      .update({
        ...preview.totals,
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
        amount: preview.totals.final_order_total,
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
      }),
      catch_weight_final_lines: preview.lines.map((line: Record<string, any>) => ({
        line_item_id: line.line_item_id,
        product_id: line.product_id,
        variant_id: line.variant_id,
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
      })),
    }

    await orderModule.updateOrders(order.id, { metadata })
    await eventBus.emit({
      name: "order.final_charge_succeeded",
      data: {
        id: order.id,
        order_id: order.id,
        finalization_id: preview.finalization.id,
        payment_intent_id: paymentIntent.id,
        amount: preview.totals.final_order_total,
        currency_code:
          preview.finalization.currency_code || order.currency_code || "usd",
      },
    })

    res.status(200).json({
      order,
      finalization: finalizationForMetadata,
      lines: preview.lines,
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
      amount: preview.totals.final_order_total,
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
        staff_actor_id: staffActor,
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

    res.status(402).json({
      message: failureMessage,
      finalization_status: FINALIZATION_CHARGE_FAILED_HOLD,
      charge_attempt: attempt,
    })
  }
}
