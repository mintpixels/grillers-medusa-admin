import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { fulfillAllocationsForFulfillment } from "../lib/inventory-allocation"
import { emitInventoryAllocationSubscriberFailureAlert } from "./inventory-allocation-alerts"

export default async function inventoryAllocationFulfillmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  try {
    const fulfilled = await fulfillAllocationsForFulfillment({
      db,
      query,
      fulfillmentId: data.id,
    })
    logger.info(
      `[inventory-allocation] fulfillment=${data.id} fulfilled_allocations=${fulfilled}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[inventory-allocation] failed to fulfill allocation for fulfillment=${data.id}: ${message}`
    )
    await emitInventoryAllocationSubscriberFailureAlert({
      action: "fulfillment_complete",
      fulfillmentId: data.id,
      error: err,
      logger,
    })
  }
}

export const config: SubscriberConfig = {
  event: "fulfillment.created",
}
