import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAllocationsForOrder } from "../lib/inventory-allocation"

export default async function inventoryAllocationOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let analytics: any = null
  try {
    analytics = container.resolve("analytics")
  } catch {
    analytics = null
  }

  try {
    const result = await createAllocationsForOrder({
      db,
      query,
      orderId: data.id,
    })

    logger.info(
      `[inventory-allocation] order=${data.id} created=${result.created} skipped=${result.skipped} blocked=${result.blocked}`
    )

    if (analytics?.track) {
      await analytics.track({
        event: "inventory_allocation_created",
        properties: {
          order_id: data.id,
          created_count: result.created,
          skipped_count: result.skipped,
          blocked_count: result.blocked,
        },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[inventory-allocation] failed to allocate order=${data.id}: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
