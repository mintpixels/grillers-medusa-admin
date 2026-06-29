import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "./ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

function redactedErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b(?:cart|order|cus|customer|variant|product|prod|qbd|qbl|inv|alloc)_[A-Za-z0-9_:-]+/g,
      "[redacted-id]"
    )
    .slice(0, 500)
}

function safeStatus(value: string | undefined) {
  if (!value) return null
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 80)
}

export async function emitInventoryAllocationListRouteFailureAlert(input: {
  req: MedusaRequest
  error: unknown
  limit: number
  offset: number
  status?: string
  hasVariantId: boolean
  hasOrderId: boolean
  hasSearch: boolean
  logger?: LoggerLike
}) {
  let logger = input.logger
  if (!logger) {
    try {
      logger = input.req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    } catch {
      logger = undefined
    }
  }

  return emitOpsAlert({
    alertKind: "inventory_allocation_list_failed",
    title: "Inventory allocation list failed",
    path: "src/api/admin/grillers/inventory/allocations/route.ts",
    source: "medusa-server",
    severity: "page",
    logger,
    meta: {
      route_status: 500,
      limit: input.limit,
      offset: input.offset,
      status: safeStatus(input.status),
      has_variant_id: input.hasVariantId,
      has_order_id: input.hasOrderId,
      has_search: input.hasSearch,
      error_message: redactedErrorMessage(input.error),
    },
  })
}
