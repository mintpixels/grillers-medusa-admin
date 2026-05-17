import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] === undefined ? undefined : String(value[0])
  }

  return value === undefined ? undefined : String(value)
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function serializeVariant(row: any) {
  return {
    variant_id: row.variant_id,
    sku: row.sku,
    variant_title: row.variant_title,
    product_id: row.product_id,
    product_title: row.product_title,
  }
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const q = normalizeText(firstQueryValue(req.query.q))
  const limit = Math.min(
    Math.max(Number(firstQueryValue(req.query.limit)) || 12, 1),
    50
  )

  if (!q) {
    res.json({ variants: [] })
    return
  }

  const like = `%${q.toLowerCase()}%`
  const rows = await db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "p.title as product_title",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder.whereNull("p.deleted_at").orWhereNull("p.id")
    })
    .andWhere((builder: any) => {
      builder
        .whereRaw("lower(coalesce(pv.id, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(pv.sku, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(pv.title, '')) like ?", [like])
        .orWhereRaw("lower(coalesce(p.title, '')) like ?", [like])
    })
    .orderByRaw(
      `case
        when lower(coalesce(pv.sku, '')) = lower(?) then 0
        when lower(coalesce(pv.id, '')) = lower(?) then 1
        when lower(coalesce(pv.sku, '')) like lower(?) then 2
        else 3
      end`,
      [q, q, `${q}%`]
    )
    .orderBy("p.title", "asc")
    .orderBy("pv.title", "asc")
    .limit(limit)

  res.json({ variants: rows.map(serializeVariant) })
}
