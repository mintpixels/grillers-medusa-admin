import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"

export default async function fulfillmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const analyticsService = container.resolve("analytics")

  try {
    await analyticsService.track({
      event: "fulfillment_created",
      properties: {
        fulfillment_id: data.id,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track fulfillment.created for ${data.id}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: "fulfillment.created",
      analyticsEvent: "fulfillment_created",
      entityId: data.id,
      path: "src/subscribers/analytics/fulfillment-created.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: "fulfillment.created",
}
