import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function shipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger = container.resolve("logger")
  const analyticsService = container.resolve("analytics")

  try {
    // Seed a DETERMINISTIC idempotency_key from the fulfillment id (+ order id
    // when present) so the shim derives a stable event_id and anonymous_id.
    // Without it, idempotencyKey() returns null → event_id + anonymous_id are
    // random on every replay, and the warehouse double-counts order_shipped.
    const idempotencyKey = data.order_id
      ? `order_shipped:${data.order_id}:${data.id}`
      : `order_shipped:${data.id}`

    await analyticsService.track({
      event: "order_shipped",
      properties: {
        fulfillment_id: data.id,
        order_id: data.order_id || undefined,
        idempotency_key: idempotencyKey,
        medusa_event_id: idempotencyKey,
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
