import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { fetchOrderForEmail } from "../lib/emails/order-fetch"
import { buildOrderPlacedEmail } from "../lib/emails/templates/order-placed"

export default async function orderPlacedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const notificationModule = container.resolve(Modules.NOTIFICATION)

  try {
    const order = await fetchOrderForEmail(container, data.id)

    if (!order) {
      logger.warn(`[order-placed-email] order not found for id=${data.id}`)
      return
    }
    if (!order.email) {
      logger.warn(`[order-placed-email] order ${order.id} has no email`)
      return
    }

    const { subject, html, text } = buildOrderPlacedEmail(order)

    logger.info(
      `[order-placed-email] sending confirmation to=${order.email} order=${order.id}`
    )

    await notificationModule.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-placed",
      content: { subject, html, text },
      data: {
        order_id: order.id,
        display_id: order.display_id,
        email: order.email,
        total: order.total,
      },
    })
  } catch (err) {
    logger.error(
      `[order-placed-email] failed for order ${data.id}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
