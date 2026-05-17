import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { classifyLegacyLineKind } from "../lib/legacy-line-kind"
import {
  getBooleanArg,
  getNumberArg,
  parseArgs,
} from "./lib/legacy-import-utils"

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export default async function backfillLegacyLineKind({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const limit = getNumberArg(args, ["limit"], 0)
  const batchSize = Math.max(1, getNumberArg(args, ["batch-size"], 1000))
  const sampleLimit = Math.max(0, getNumberArg(args, ["sample-limit"], 20))

  const query = db("legacy_order_line")
    .select([
      "id",
      "qbd_item_list_id",
      "sku",
      "title",
      "description",
      "line_total",
      "mapping_status",
      "metadata",
    ])
    .whereNull("deleted_at")
    .whereIn("mapping_status", ["unmapped", "non_product"])
    .orderBy("created_at", "asc")

  if (limit > 0) {
    query.limit(limit)
  }

  const rows = await query
  const stats = {
    scanned: rows.length,
    unmappedProductKept: 0,
    unmappedToNonProduct: 0,
    nonProductKept: 0,
    nonProductNowLooksProduct: 0,
    byKind: {} as Record<string, number>,
    samples: [] as Array<{
      id: string
      kind: string
      sku: string | null
      title: string | null
      description: string | null
    }>,
  }
  const updatesByKind = new Map<string, string[]>()

  for (const row of rows) {
    const kind = classifyLegacyLineKind({
      qbdItemListId: row.qbd_item_list_id,
      sku: row.sku,
      title: row.title,
      description: row.description,
      lineTotal: row.line_total,
      metadata: row.metadata,
      mappingStatus: row.mapping_status,
    })

    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1

    if (row.mapping_status === "unmapped" && kind === "product") {
      stats.unmappedProductKept += 1
      continue
    }

    if (row.mapping_status === "non_product" && kind === "product") {
      stats.nonProductNowLooksProduct += 1
      continue
    }

    if (row.mapping_status === "non_product") {
      stats.nonProductKept += 1
      continue
    }

    stats.unmappedToNonProduct += 1
    if (stats.samples.length < sampleLimit) {
      stats.samples.push({
        id: row.id,
        kind,
        sku: row.sku,
        title: row.title,
        description: row.description,
      })
    }

    const ids = updatesByKind.get(kind) ?? []
    ids.push(row.id)
    updatesByKind.set(kind, ids)
  }

  if (apply) {
    const now = new Date()
    for (const [kind, ids] of updatesByKind.entries()) {
      for (const idsChunk of chunk(ids, batchSize)) {
        await db("legacy_order_line")
          .whereIn("id", idsChunk)
          .update({
            mapping_status: "non_product",
            metadata: db.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
              JSON.stringify({
                line_kind: kind,
                line_kind_backfilled_by: "backfill-legacy-line-kind",
                line_kind_backfilled_at: now.toISOString(),
                previous_mapping_status: "unmapped",
              }),
            ]),
            updated_at: now,
          })
      }
    }
  }

  logger.info(
    `[legacy-line-kind-backfill] ${apply ? "applied" : "dry-run"} ${JSON.stringify(stats)}`
  )
}
