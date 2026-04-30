import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { fetchOrderForEmail } from "../lib/emails/order-fetch"
import { buildRefundIssuedEmail } from "../lib/emails/templates/refund-issued"

type RefundEventData = {
  id: string
  order_id?: string
  amount?: number | string
  reason?: string
}

export default async function refundIssuedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<RefundEventData>) {
  const logger = container.resolve("logger")
  const notificationModule = container.resolve(Modules.NOTIFICATION)
  const query = container.resolve("query")

  try {
    let orderId = data.order_id
    let refundAmount = data.amount

    if (!orderId || refundAmount === undefined) {
      const { data: refunds } = await query.graph({
        entity: "refund",
        fields: ["id", "amount", "payment.payment_collection_id", "payment.payment_collection.cart_id"],
        filters: { id: data.id },
      })
      const refund = refunds?.[0] as any
      if (refund) {
        refundAmount = refundAmount ?? refund.amount
        const paymentCollectionId = refund.payment?.payment_collection_id
        if (paymentCollectionId && !orderId) {
          const { data: orderPCs } = await query.graph({
            entity: "order_payment_collection",
            fields: ["order_id"],
            filters: { payment_collection_id: paymentCollectionId },
          })
          orderId = orderPCs?.[0]?.order_id
        }
      }
    }

    if (!orderId) {
      logger.warn(`[refund-issued-email] could not resolve order_id for refund ${data.id}`)
      return
    }

    const order = await fetchOrderForEmail(container, orderId)
    if (!order || !order.email) return

    const { subject, html, text } = buildRefundIssuedEmail({
      order,
      refundAmount: refundAmount ?? 0,
      reason: data.reason,
    })

    logger.info(
      `[refund-issued-email] sending to=${order.email} order=${order.id} amount=${refundAmount}`
    )

    await notificationModule.createNotifications({
      to: order.email,
      channel: "email",
      template: "refund-issued",
      content: { subject, html, text },
      data: {
        order_id: order.id,
        display_id: order.display_id,
        refund_amount: refundAmount,
      },
    })
  } catch (err) {
    logger.error(
      `[refund-issued-email] failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "refund.created",
}
