import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function shipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const analyticsService = container.resolve("analytics")

  try {
    await analyticsService.track({
      event: "order_shipped",
      properties: {
        fulfillment_id: data.id,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track fulfillment.shipment_created for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "fulfillment.shipment_created",
}
