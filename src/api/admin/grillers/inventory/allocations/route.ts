import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitInventoryAllocationListRouteFailureAlert } from "../../../../../lib/inventory-allocation-route-alerts"

const ACTIVE_STATUSES = ["reserved", "future_committed", "blocked"]

function queryText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

function queryInteger(
  value: unknown,
  fallback: number,
  min: number,
  max?: number
) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : fallback
  const finite = Number.isFinite(parsed) ? Math.floor(parsed) : fallback
  const boundedMin = Math.max(min, finite)
  return max === undefined ? boundedMin : Math.min(max, boundedMin)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const params = (req.query || {}) as Record<string, unknown>
  const limit = queryInteger(params.limit, 50, 1, 100)
  const offset = queryInteger(params.offset, 0, 0)
  const status = queryText(params.status)
  const variantId = queryText(params.variant_id)
  const orderId = queryText(params.order_id)
  const search = queryText(params.q)

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    let query = db("gp_inventory_allocation")
      .select("*")
      .whereNull("deleted_at")
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)

    if (status === "active") {
      query = query.whereIn("status", ACTIVE_STATUSES)
    } else if (status) {
      query = query.where("status", status)
    }
    if (variantId) query = query.where("variant_id", variantId)
    if (orderId) query = query.where("order_id", orderId)
    if (search) {
      query = query.andWhere((builder: any) => {
        builder
          .whereILike("customer_title", `%${search}%`)
          .orWhereILike("sku", `%${search}%`)
          .orWhereILike("customer_email", `%${search}%`)
          .orWhereILike("order_id", `%${search}%`)
      })
    }

    const rows = await query
    res.status(200).json({ allocations: rows, limit, offset })
  } catch (error) {
    await emitInventoryAllocationListRouteFailureAlert({
      req,
      error,
      limit,
      offset,
      status,
      hasVariantId: Boolean(variantId),
      hasOrderId: Boolean(orderId),
      hasSearch: Boolean(search),
    })
    res.status(500).json({
      ok: false,
      message: "Could not load inventory allocations.",
    })
  }
}
