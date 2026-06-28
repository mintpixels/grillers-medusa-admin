import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"

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

    const order = orders?.[0] as any
    if (!order) return
    const customerId = order.customer_id || undefined

    await analyticsService.track({
      event: "order_canceled",
      actor_id: customerId,
      properties: {
        order_id: order.id,
        value: order.total ?? 0,
        currency: order.currency_code,
        customer_id: customerId,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track order.canceled for ${data.id}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: "order.canceled",
      analyticsEvent: "order_canceled",
      entityId: data.id,
      path: "src/subscribers/analytics/order-canceled.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
