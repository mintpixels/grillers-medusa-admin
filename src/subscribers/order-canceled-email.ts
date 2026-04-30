import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { fetchOrderForEmail } from "../lib/emails/order-fetch"
import { buildOrderCanceledEmail } from "../lib/emails/templates/order-canceled"

export default async function orderCanceledEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; reason?: string }>) {
  const logger = container.resolve("logger")
  const notificationModule = container.resolve(Modules.NOTIFICATION)

  try {
    const order = await fetchOrderForEmail(container, data.id)
    if (!order || !order.email) return

    const { subject, html, text } = buildOrderCanceledEmail({
      order,
      reason: data.reason,
    })

    logger.info(
      `[order-canceled-email] sending to=${order.email} order=${order.id}`
    )

    await notificationModule.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-canceled",
      content: { subject, html, text },
      data: {
        order_id: order.id,
        display_id: order.display_id,
        reason: data.reason,
      },
    })
  } catch (err) {
    logger.error(
      `[order-canceled-email] failed for order ${data.id}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
