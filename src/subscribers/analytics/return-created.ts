import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"

export default async function returnCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const analyticsService = container.resolve("analytics")

  try {
    await analyticsService.track({
      event: "return_created",
      properties: {
        return_id: data.id,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track return.created for ${data.id}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: "return.created",
      analyticsEvent: "return_created",
      entityId: data.id,
      path: "src/subscribers/analytics/return-created.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: "return.created",
}
