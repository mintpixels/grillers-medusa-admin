import { emitOpsAlert } from "../lib/ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

export type InventoryAllocationSubscriberAction =
  | "order_allocate"
  | "order_cancel_release"
  | "fulfillment_complete"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || "Unknown error")
}

function subscriberPath(action: InventoryAllocationSubscriberAction) {
  if (action === "order_allocate") {
    return "src/subscribers/inventory-allocation-order-placed.ts"
  }
  if (action === "order_cancel_release") {
    return "src/subscribers/inventory-allocation-order-canceled.ts"
  }
  return "src/subscribers/inventory-allocation-fulfillment-created.ts"
}

export function emitInventoryAllocationSubscriberFailureAlert(input: {
  action: InventoryAllocationSubscriberAction
  orderId?: string | null
  fulfillmentId?: string | null
  error: unknown
  logger?: LoggerLike
}) {
  return emitOpsAlert({
    alertKind: "inventory_allocation_subscriber_failed",
    severity: "page",
    title: `Inventory allocation subscriber failed: ${input.action}`,
    path: subscriberPath(input.action),
    source: "medusa-server",
    logger: input.logger,
    meta: {
      action: input.action,
      order_id: input.orderId || null,
      fulfillment_id: input.fulfillmentId || null,
      error_message: errorMessage(input.error).slice(0, 500),
    },
  })
}
