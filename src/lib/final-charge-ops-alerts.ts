import { emitOpsAlert } from "./ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

/**
 * MONEY-CRITICAL guard alert. Fires when the final charge flow is about to
 * transition an order to `charged_ready_to_ship` — which lifts the fulfillment
 * gate, queues the QBD invoice, and emails the customer — while the Stripe
 * PaymentIntent is NOT yet `succeeded` (e.g. `processing`, `requires_action`).
 * An iced box shipping against a charge that has not settled is the exact risk.
 *
 * In the current flow the transition is already blocked because
 * `assertStripeFinalPaymentIntentSucceeded` throws for any non-succeeded
 * status; this alert makes that block (or a future opt-in non-blocking variant
 * gated by GRILLERS_BLOCK_NONSUCCEEDED_CHARGE) visible to the pager.
 */
export async function emitChargeMarkedReadyButPiNotSucceededAlert({
  logger,
  orderId,
  finalizationId,
  paymentIntentId,
  paymentIntentStatus,
  amount,
  blocked,
}: {
  logger?: LoggerLike
  orderId: string
  finalizationId: string
  paymentIntentId: string
  paymentIntentStatus: string
  amount: number
  blocked: boolean
}) {
  return emitOpsAlert({
    alertKind: "charge_marked_ready_but_pi_not_succeeded",
    title: `Final charge would mark order ${orderId} ready while PaymentIntent ${paymentIntentId} is ${paymentIntentStatus}`,
    path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
    source: "medusa",
    severity: "page",
    logger,
    meta: {
      order_id: orderId,
      finalization_id: finalizationId,
      payment_intent_id: paymentIntentId,
      payment_intent_status: paymentIntentStatus,
      amount,
      // true = transition was/will be blocked (assert trips or opt-in flag set);
      // false = alert-only, existing control flow unchanged.
      transition_blocked: blocked,
    },
  })
}

/**
 * MONEY-CRITICAL. Fires from the Stripe `payment_intent.payment_failed`
 * webhook when the failing PaymentIntent belongs to an order ALREADY marked
 * `charged_ready_to_ship`. The box may already be moving against a charge that
 * just failed — page immediately.
 */
export async function emitChargeFailedPostShipAlert({
  logger,
  orderId,
  finalizationId,
  paymentIntentId,
  paymentIntentStatus,
  failureCode,
  failureMessage,
}: {
  logger?: LoggerLike
  orderId: string
  finalizationId?: string | null
  paymentIntentId: string
  paymentIntentStatus?: string | null
  failureCode?: string | null
  failureMessage?: string | null
}) {
  return emitOpsAlert({
    alertKind: "charge_failed_post_ship",
    title: `PaymentIntent ${paymentIntentId} failed for order ${orderId} already marked charged_ready_to_ship`,
    path: "src/api/webhooks/stripe/payment-failed/route.ts",
    source: "medusa",
    severity: "page",
    logger,
    meta: {
      order_id: orderId,
      finalization_id: finalizationId || null,
      payment_intent_id: paymentIntentId,
      payment_intent_status: paymentIntentStatus || null,
      failure_code: failureCode || null,
      failure_message: failureMessage ? String(failureMessage).slice(0, 300) : null,
    },
  })
}

export async function emitFinalChargeNonSucceededAlert({
  logger,
  orderId,
  finalizationId,
  paymentIntentId,
  paymentIntentStatus,
  amount,
}: {
  logger?: LoggerLike
  orderId: string
  finalizationId: string
  paymentIntentId: string
  paymentIntentStatus: string
  amount: number
}) {
  return emitOpsAlert({
    alertKind: "final_charge_non_succeeded_payment_intent",
    title: `Final charge PaymentIntent ${paymentIntentId} returned ${paymentIntentStatus}`,
    path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
    source: "medusa",
    severity: "page",
    logger,
    meta: {
      order_id: orderId,
      finalization_id: finalizationId,
      payment_intent_id: paymentIntentId,
      payment_intent_status: paymentIntentStatus,
      amount,
    },
  })
}

export async function emitChargeFailedHoldAlert({
  logger,
  orderId,
  finalizationId,
  chargeAttemptId,
  paymentIntentId,
  paymentIntentStatus,
  failureCode,
  failureMessage,
}: {
  logger?: LoggerLike
  orderId: string
  finalizationId: string
  chargeAttemptId: string
  paymentIntentId?: string | null
  paymentIntentStatus?: string | null
  failureCode?: string | null
  failureMessage: string
}) {
  return emitOpsAlert({
    alertKind: "charge_failed_hold",
    title: `Final charge failed for order ${orderId}`,
    path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
    source: "medusa",
    severity: "page",
    logger,
    meta: {
      order_id: orderId,
      finalization_id: finalizationId,
      charge_attempt_id: chargeAttemptId,
      payment_intent_id: paymentIntentId || null,
      payment_intent_status: paymentIntentStatus || null,
      failure_code: failureCode || null,
      failure_message: failureMessage,
    },
  })
}
