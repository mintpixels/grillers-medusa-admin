import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

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
  }
}

export const config: SubscriberConfig = {
  event: "order.completed",
}
