import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { fetchOrderForEmail } from "../lib/emails/order-fetch"
import { emitOpsAlert } from "../lib/ops-alert"
import { sendOrderSmsEnrollmentConfirmation } from "../lib/communications/transactional-sms"

type OrderPlacedEventData = {
  id: string
  order_id?: string
}

export default async function orderSmsEnrollmentConfirmationHandler({
  event: { data },
  container,
}: SubscriberArgs<OrderPlacedEventData>) {
  const logger = container.resolve("logger")
  const orderId = String(data.order_id || data.id || "").trim()

  if (!orderId) {
    logger.warn("[order-sms-enrollment] skipped because order id is missing")
    return
  }

  try {
    const order = await fetchOrderForEmail(container, orderId)
    if (!order) {
      logger.warn(`[order-sms-enrollment] order not found id=${orderId}`)
      return
    }

    const result = await sendOrderSmsEnrollmentConfirmation(container, {
      order,
    })
    logger.info(
      `[order-sms-enrollment] order=${order.id} queued=${
        result.ok && !result.skipped
      } skipped=${Boolean(result.skipped)}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(
      `[order-sms-enrollment] failed order=${orderId}: ${message}`
    )
    await emitOpsAlert({
      alertKind: "communications_transactional_sms_send_failed",
      severity: "warn",
      title: "Transactional order SMS enrollment confirmation failed",
      path: "src/subscribers/order-sms-enrollment-confirmation.ts",
      fingerprint: "transactional_sms_send:order-sms-enrollment-confirmation",
      logger,
      meta: {
        template_key: "order-sms-enrollment-confirmation",
        purpose: "delivery_notifications",
        order_id: orderId,
        message: message.replace(/\+\d{10,15}/g, "[redacted-phone]").slice(0, 300),
      },
    }).catch(() => {})
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
