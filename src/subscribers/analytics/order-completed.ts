import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"

export default async function orderCompletedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const analyticsService = container.resolve("analytics")

  try {
    await analyticsService.track({
      event: "order_fulfilled",
      properties: {
        order_id: data.id,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track order.completed for ${data.id}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: "order.completed",
      analyticsEvent: "order_fulfilled",
      entityId: data.id,
      path: "src/subscribers/analytics/order-completed.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
