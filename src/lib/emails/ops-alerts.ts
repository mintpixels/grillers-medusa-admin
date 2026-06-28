import type { Logger } from "@medusajs/framework/types"
import { emitOpsAlert } from "../ops-alert"

type LoggerLike = Pick<Logger, "warn" | "error">

type TransactionalEmailPreconditionAlertInput = {
  logger?: LoggerLike
  templateKey: string
  reason:
    | "order_not_found"
    | "order_missing_email"
    | "fulfillment_not_found"
    | "order_id_not_resolved"
  path: string
  eventName?: string
  eventId?: string | null
  orderId?: string | null
  displayId?: string | number | null
  fulfillmentId?: string | null
  paymentId?: string | null
  refundId?: string | null
}

type TransactionalEmailHandlerFailureAlertInput = {
  logger?: LoggerLike
  templateKey: string
  path: string
  eventName?: string
  eventId?: string | null
  orderId?: string | null
  displayId?: string | number | null
  customerId?: string | null
  fulfillmentId?: string | null
  paymentId?: string | null
  refundId?: string | null
  error: unknown
}

function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500)
}

export function emitTransactionalEmailPreconditionAlert({
  logger,
  templateKey,
  reason,
  path,
  eventName,
  eventId,
  orderId,
  displayId,
  fulfillmentId,
  paymentId,
  refundId,
}: TransactionalEmailPreconditionAlertInput) {
  return emitOpsAlert({
    alertKind: "transactional_email_precondition_failed",
    severity: "warn",
    title: `${templateKey} email skipped: ${reason}`,
    path,
    source: "medusa-server",
    logger,
    meta: {
      template_key: templateKey,
      reason,
      event_name: eventName || null,
      event_id: eventId || null,
      order_id: orderId || null,
      display_id: displayId ?? null,
      fulfillment_id: fulfillmentId || null,
      payment_id: paymentId || null,
      refund_id: refundId || null,
    },
  })
}

export function emitTransactionalEmailHandlerFailureAlert({
  logger,
  templateKey,
  path,
  eventName,
  eventId,
  orderId,
  displayId,
  customerId,
  fulfillmentId,
  paymentId,
  refundId,
  error,
}: TransactionalEmailHandlerFailureAlertInput) {
  return emitOpsAlert({
    alertKind: "transactional_email_handler_failed",
    severity: "warn",
    title: `${templateKey} email handler failed`,
    path,
    source: "medusa-server",
    logger,
    meta: {
      template_key: templateKey,
      event_name: eventName || null,
      event_id: eventId || null,
      order_id: orderId || null,
      display_id: displayId ?? null,
      customer_id: customerId || null,
      fulfillment_id: fulfillmentId || null,
      payment_id: paymentId || null,
      refund_id: refundId || null,
      error_message: redactedErrorMessage(error),
    },
  })
}
