import { emitOpsAlert } from "./ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

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
