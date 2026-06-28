import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { releaseAllocationsForOrder } from "../lib/inventory-allocation"
import { emitInventoryAllocationSubscriberFailureAlert } from "../lib/inventory-allocation-subscriber-alerts"

export default async function inventoryAllocationOrderCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; reason?: string }>) {
  const logger = container.resolve("logger")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let analytics: any = null
  try {
    analytics = container.resolve("analytics")
  } catch {
    analytics = null
  }

  try {
    const released = await releaseAllocationsForOrder({
      db,
      orderId: data.id,
      reason: "released_cancellation",
      note: data.reason || null,
    })

    logger.info(
      `[inventory-allocation] order=${data.id} cancellation released=${released}`
    )

    if (analytics?.track && released > 0) {
      await analytics.track({
        event: "inventory_allocation_released",
        properties: {
          order_id: data.id,
          released_count: released,
          reason: "released_cancellation",
        },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[inventory-allocation] failed to release canceled order=${data.id}: ${message}`
    )
    await emitInventoryAllocationSubscriberFailureAlert({
      action: "order_cancel_release",
      orderId: data.id,
      error: err,
      logger,
    })
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
