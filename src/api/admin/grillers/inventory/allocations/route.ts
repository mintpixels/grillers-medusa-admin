import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const ACTIVE_STATUSES = ["reserved", "future_committed", "blocked"]

function queryText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim()
  return undefined
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const params = (req.query || {}) as Record<string, unknown>
  const limit = Math.min(100, Math.max(1, Number(params.limit || 50)))
  const offset = Math.max(0, Number(params.offset || 0))
  const status = queryText(params.status)
  const variantId = queryText(params.variant_id)
  const orderId = queryText(params.order_id)
  const search = queryText(params.q)

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
}
