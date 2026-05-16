import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function orderCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "customer_id", "total", "currency_code"],
      filters: { id: data.id },
    })

    const order = orders?.[0]
    if (!order) return

    await analyticsService.track({
      event: "order_canceled",
      actor_id: order.customer_id || undefined,
      properties: {
        order_id: order.id,
        value: order.total,
        currency: order.currency_code,
        customer_id: order.customer_id,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track order.canceled for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
