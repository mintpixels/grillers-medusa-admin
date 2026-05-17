import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] === undefined ? undefined : String(value[0])
  }

  return value === undefined ? undefined : String(value)
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof (value as any).toNumber === "function") {
    return Number((value as any).toNumber())
  }

  return 0
}

function serializeRequest(row: any) {
  return {
    id: row.id,
    medusa_customer_id: row.medusa_customer_id,
    email_lower: row.email_lower,
    customer_name: row.customer_name,
    legacy_history_key: row.legacy_history_key,
    legacy_item_id: row.legacy_item_id,
    sku: row.sku,
    title: row.title,
    product_title: row.product_title,
    last_ordered_at: row.last_ordered_at
      ? new Date(row.last_ordered_at).toISOString()
      : null,
    last_order_ref: row.last_order_ref,
    times_ordered: asNumber(row.times_ordered),
    order_count: asNumber(row.order_count),
    total_quantity: asNumber(row.total_quantity),
    unit_price: asNumber(row.unit_price),
    currency_code: row.currency_code || "usd",
    request_status: row.request_status,
    notification_status: row.notification_status,
    notification_error: row.notification_error,
    requested_at: row.requested_at
      ? new Date(row.requested_at).toISOString()
      : null,
    metadata: row.metadata ?? null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const limit = Math.min(
    Math.max(Number(firstQueryValue(req.query.limit)) || 25, 1),
    100
  )
  const offset = Math.max(Number(firstQueryValue(req.query.offset)) || 0, 0)
  const status = firstQueryValue(req.query.status)?.trim()
  const q = firstQueryValue(req.query.q)?.trim()

  const base = db("legacy_reorder_request").whereNull("deleted_at")

  if (status && status !== "all") {
    base.andWhere("request_status", status)
  }

  if (q) {
    const like = `%${q.toLowerCase()}%`
    base.andWhere((builder: any) => {
      builder
        .whereRaw("lower(coalesce(id, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(customer_name, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(email_lower, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(title, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(product_title, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(sku, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(last_order_ref, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(legacy_item_id, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(legacy_history_key, '')) like ?", [like])
    })
  }

  const countQuery = base.clone().clearSelect().count({ count: "*" }).first()
  const rows = await base
    .clone()
    .select("*")
    .orderByRaw(
      "case request_status when 'submitted' then 0 when 'notification_failed' then 1 when 'contacted' then 2 when 'mapped' then 3 when 'resolved' then 4 else 5 end"
    )
    .orderBy("requested_at", "desc")
    .limit(limit)
    .offset(offset)

  const countRow = await countQuery

  res.json({
    requests: rows.map(serializeRequest),
    count: asNumber(countRow?.count),
    limit,
    offset,
  })
}
