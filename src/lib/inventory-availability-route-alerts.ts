import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "./ops-alert"

type AvailabilityLineInput = {
  product_id?: string
  variant_id?: string
  quantity?: number | string
}

const redactedErrorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error || "Unknown error"))
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b(?:cart|order|cus|customer|variant|product|prod|qbd|qbl|inv)_[A-Za-z0-9_:-]+/g,
      "[redacted-id]"
    )
    .slice(0, 500)

export async function emitInventoryAvailabilityRouteFailureAlert(input: {
  req: MedusaRequest
  error: unknown
  path: string
  surface: "store" | "admin"
  source: string
  lines: AvailabilityLineInput[]
  cartId?: string | null
  orderId?: string | null
  customerId?: string | null
  fulfillmentType?: string | null
  requestedFulfillmentDate?: string | null
  includeInternal: boolean
  recordSnapshots: boolean
}) {
  let logger: any
  try {
    logger = input.req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  return emitOpsAlert({
    alertKind: "inventory_availability_route_failed",
    title: `Inventory availability check failed: ${input.surface}`,
    path: input.path,
    source: "medusa-server",
    severity: "page",
    logger,
    meta: {
      surface: input.surface,
      availability_source: input.source,
      route_status: 500,
      line_count: input.lines.length,
      has_cart_id: Boolean(input.cartId),
      has_order_id: Boolean(input.orderId),
      has_customer_id: Boolean(input.customerId),
      has_fulfillment_type: Boolean(input.fulfillmentType),
      has_requested_fulfillment_date: Boolean(input.requestedFulfillmentDate),
      include_internal: input.includeInternal,
      record_snapshots: input.recordSnapshots,
      error_message: redactedErrorMessage(input.error),
    },
  })
}
