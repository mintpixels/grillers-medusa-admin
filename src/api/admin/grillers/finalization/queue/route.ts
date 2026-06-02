import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const DEFAULT_STATUSES = [
  "pending_pack",
  "packing",
  "packed_pending_review",
  "packed_pending_charge",
  "charge_failed_hold",
  "charged_ready_to_ship",
]

const OPEN_STATUSES_WITHOUT_FINAL_TOTALS = new Set([
  "pending_pack",
  "packing",
  "packed_pending_review",
])

const clampLimit = (value: unknown) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(Math.round(parsed), 200)
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const statusQuery = req.query?.status
  const statuses =
    typeof statusQuery === "string" && statusQuery.trim()
      ? statusQuery.split(",").map((status) => status.trim()).filter(Boolean)
      : DEFAULT_STATUSES

  const rows = await db("gp_order_finalization")
    .select("*")
    .whereNull("deleted_at")
    .whereIn("status", statuses)
    .orderByRaw(
      "case status when 'charge_failed_hold' then 0 when 'packed_pending_charge' then 1 when 'packed_pending_review' then 2 when 'packing' then 3 else 4 end"
    )
    .orderBy("created_at", "asc")
    .limit(clampLimit(req.query?.limit))

  const finalizations = (rows || []).map((row: Record<string, any>) =>
    OPEN_STATUSES_WITHOUT_FINAL_TOTALS.has(row.status)
      ? {
          ...row,
          final_item_total: null,
          final_shipping_total: null,
          final_tax_total: null,
          final_discount_total: null,
          final_order_total: null,
          delta_total: null,
        }
      : row
  )

  res.status(200).json({
    finalizations,
    count: finalizations.length,
  })
}
