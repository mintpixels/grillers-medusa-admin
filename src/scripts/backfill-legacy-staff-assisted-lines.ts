import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  getBooleanArg,
  getNumberArg,
  parseArgs,
  toNumber,
} from "./lib/legacy-import-utils"
import { classifyLegacyLineKind } from "../lib/legacy-line-kind"

type CandidateRow = {
  id: string
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  description: string | null
  unit_price: string | number | null
  line_total: string | number | null
  medusa_variant_id: string | null
  mapping_status: string | null
  metadata: Record<string, unknown> | null
}

function isStaffAssistedCandidate(row: CandidateRow) {
  if (row.mapping_status !== "unmapped" || row.medusa_variant_id) {
    return false
  }

  if (toNumber(row.unit_price) > 0 || toNumber(row.line_total) > 0) {
    return false
  }

  return (
    classifyLegacyLineKind({
      qbdItemListId: row.qbd_item_list_id,
      sku: row.sku,
      title: row.title,
      description: row.description,
      lineTotal: row.line_total,
      metadata: row.metadata,
      mappingStatus: row.mapping_status,
    }) === "product"
  )
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export default async function backfillLegacyStaffAssistedLines({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const limit = Math.max(getNumberArg(args, ["limit"], 0), 0)
  const batchSize = Math.max(getNumberArg(args, ["batch-size"], 500), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 20), 0)

  const query = db("legacy_order_line")
    .select([
      "id",
      "qbd_item_list_id",
      "sku",
      "title",
      "description",
      "unit_price",
      "line_total",
      "medusa_variant_id",
      "mapping_status",
      "metadata",
    ])
    .whereNull("deleted_at")
    .where("mapping_status", "unmapped")
    .whereNull("medusa_variant_id")
    .orderBy("updated_at", "desc")

  if (limit > 0) {
    query.limit(limit)
  }

  const rows = (await query) as CandidateRow[]
  const candidates = rows.filter(isStaffAssistedCandidate)
  const now = new Date()
  const samples = candidates.slice(0, sampleLimit).map((row) => ({
    id: row.id,
    qbd_item_list_id: row.qbd_item_list_id,
    sku: row.sku,
    title: row.title,
    description: row.description,
    unit_price: toNumber(row.unit_price),
    line_total: toNumber(row.line_total),
  }))

  let rowsBackfilled = 0
  if (apply && candidates.length) {
    for (const ids of chunk(
      candidates.map((candidate) => candidate.id),
      batchSize
    )) {
      const updated = await db("legacy_order_line")
        .whereIn("id", ids)
        .where("mapping_status", "unmapped")
        .whereNull("deleted_at")
        .update({
          mapping_status: "staff_assisted",
          metadata: db.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
            JSON.stringify({
              line_kind: "product",
              staff_assisted: true,
              staff_assisted_reason: "non_positive_legacy_price",
              previous_mapping_status: "unmapped",
              mapping_source: "staff_assisted_non_positive_legacy_price",
              backfilled_by: "backfill-legacy-staff-assisted-lines",
              backfilled_at: now.toISOString(),
            }),
          ]),
          updated_at: now,
        })

      rowsBackfilled += Number(updated) || 0
    }
  }

  logger.info(
    `[legacy-staff-assisted-lines] ${apply ? "applied" : "dry-run"} ${JSON.stringify(
      {
        scanned: rows.length,
        candidates: candidates.length,
        rowsWouldBackfill: apply ? 0 : candidates.length,
        rowsBackfilled,
        samples,
      }
    )}`
  )
}
