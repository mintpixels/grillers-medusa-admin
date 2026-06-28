import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { checkInventoryAvailability } from "../../../../lib/inventory-allocation"
import { emitInventoryAvailabilityRouteFailureAlert } from "../../../../lib/inventory-availability-route-alerts"

type AvailabilityBody = {
  cart_id?: string
  fulfillment_type?: string
  requested_fulfillment_date?: string
  lines?: Array<{
    product_id?: string
    variant_id?: string
    quantity?: number | string
    sku?: string
    title?: string
  }>
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as AvailabilityBody
  const lines = (body.lines || [])
    .filter((line) => line.variant_id)
    .map((line) => ({
      product_id: line.product_id,
      variant_id: line.variant_id!,
      quantity: Number(line.quantity || 1),
      sku: line.sku,
      title: line.title,
    }))

  if (!lines.length) {
    res.status(400).json({ ok: false, message: "At least one variant is required." })
    return
  }

  const source = "customer_web"
  const includeInternal = false
  const recordSnapshots = true

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    const availability = await checkInventoryAvailability({
      db,
      query,
      lines,
      cart_id: body.cart_id,
      fulfillment_type: body.fulfillment_type,
      requested_fulfillment_date: body.requested_fulfillment_date,
      source,
      include_internal: includeInternal,
      record_snapshots: recordSnapshots,
    })

    res.status(200).json({ ok: true, lines: availability })
  } catch (error) {
    await emitInventoryAvailabilityRouteFailureAlert({
      req,
      error,
      path: "src/api/store/gp-inventory/availability/route.ts",
      surface: "store",
      source,
      lines,
      cartId: body.cart_id || null,
      fulfillmentType: body.fulfillment_type || null,
      requestedFulfillmentDate: body.requested_fulfillment_date || null,
      includeInternal,
      recordSnapshots,
    })
    res.status(500).json({
      ok: false,
      message: "Could not check inventory availability.",
    })
  }
}
