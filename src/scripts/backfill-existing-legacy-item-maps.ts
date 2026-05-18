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
  item_map_id: string
  qbd_item_list_id: string
  qbd_name: string | null
  sku: string | null
  medusa_product_id: string | null
  medusa_variant_id: string
  medusa_product_title: string | null
  medusa_variant_title: string | null
  confidence: string | number | null
  mapping_source: string | null
  stale_line_count: string | number
  variant_id: string | null
  variant_sku: string | null
  variant_title: string | null
  variant_product_id: string | null
  product_title: string | null
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function staleLineBaseQuery(db: any, qbdItemListId: string) {
  return db("legacy_order_line")
    .whereNull("deleted_at")
    .where("qbd_item_list_id", qbdItemListId)
    .whereIn("mapping_status", ["unmapped", "staff_assisted"])
    .whereRaw("coalesce(metadata->>'line_kind', 'product') = 'product'")
}

async function listCandidates(
  db: any,
  input: { limit: number }
): Promise<CandidateRow[]> {
  const query = db("legacy_item_map as lim")
    .leftJoin("product_variant as pv", function joinVariant(this: any) {
      this.on("pv.id", "=", "lim.medusa_variant_id").andOnNull("pv.deleted_at")
    })
    .leftJoin("product as p", function joinProduct(this: any) {
      this.on("p.id", "=", "pv.product_id").andOnNull("p.deleted_at")
    })
    .join("legacy_order_line as lol", function joinLine(this: any) {
      this.on("lol.qbd_item_list_id", "=", "lim.qbd_item_list_id")
        .andOnNull("lol.deleted_at")
        .andOn(
          db.raw("lol.mapping_status in (?, ?)", [
            "unmapped",
            "staff_assisted",
          ])
        )
        .andOn(
          db.raw("coalesce(lol.metadata->>'line_kind', 'product')"),
          "=",
          db.raw("?", ["product"])
        )
    })
    .select([
      "lim.id as item_map_id",
      "lim.qbd_item_list_id",
      "lim.qbd_name",
      "lim.sku",
      "lim.medusa_product_id",
      "lim.medusa_variant_id",
      "lim.medusa_product_title",
      "lim.medusa_variant_title",
      "lim.confidence",
      "lim.mapping_source",
      "pv.id as variant_id",
      "pv.sku as variant_sku",
      "pv.title as variant_title",
      "pv.product_id as variant_product_id",
      "p.title as product_title",
      db.raw("count(lol.id) as stale_line_count"),
    ])
    .whereNull("lim.deleted_at")
    .whereNotNull("lim.medusa_variant_id")
    .groupBy([
      "lim.id",
      "lim.qbd_item_list_id",
      "lim.qbd_name",
      "lim.sku",
      "lim.medusa_product_id",
      "lim.medusa_variant_id",
      "lim.medusa_product_title",
      "lim.medusa_variant_title",
      "lim.confidence",
      "lim.mapping_source",
      "pv.id",
      "pv.sku",
      "pv.title",
      "pv.product_id",
      "p.title",
    ])
    .orderByRaw("count(lol.id) desc")

  if (input.limit > 0) {
    query.limit(input.limit)
  }

  return query
}

export default async function backfillExistingLegacyItemMaps({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const limit = Math.max(getNumberArg(args, ["limit"], 0), 0)
  const batchSize = Math.max(getNumberArg(args, ["batch-size"], 1000), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 10), 0)
  const candidates = await listCandidates(db, { limit })
  const now = new Date()
  const stats = {
    scannedMaps: candidates.length,
    mapsWithMissingVariant: 0,
    mapsBackfilled: 0,
    rawStaleLineRows: 0,
    staleProductLineRows: 0,
    staleNonProductRowsSkipped: 0,
    rowsBackfilled: 0,
    samples: [] as Array<Record<string, unknown>>,
  }

  for (const candidate of candidates) {
    const rawStaleCount = toNumber(candidate.stale_line_count)
    stats.rawStaleLineRows += rawStaleCount
    const rows = await staleLineBaseQuery(db, candidate.qbd_item_list_id)
      .clone()
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
    const productRows = rows.filter(
      (row: any) =>
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
    const productStaleCount = productRows.length
    const skippedNonProductCount = rows.length - productStaleCount

    stats.staleProductLineRows += productStaleCount
    stats.staleNonProductRowsSkipped += skippedNonProductCount

    if (!productStaleCount) {
      if (stats.samples.length < sampleLimit) {
        stats.samples.push({
          status: "skipped_non_product",
          qbd_item_list_id: candidate.qbd_item_list_id,
          sku: candidate.sku,
          medusa_variant_id: candidate.medusa_variant_id,
          raw_stale_line_count: rawStaleCount,
        })
      }
      continue
    }

    if (!candidate.variant_id) {
      stats.mapsWithMissingVariant += 1
      if (stats.samples.length < sampleLimit) {
        stats.samples.push({
          status: "missing_variant",
          qbd_item_list_id: candidate.qbd_item_list_id,
          sku: candidate.sku,
          medusa_variant_id: candidate.medusa_variant_id,
          stale_product_line_count: productStaleCount,
        })
      }
      continue
    }

    const medusaProductId =
      normalizeText(candidate.variant_product_id) ||
      normalizeText(candidate.medusa_product_id)
    const medusaVariantTitle =
      normalizeText(candidate.variant_title) ||
      normalizeText(candidate.medusa_variant_title)
    const medusaProductTitle =
      normalizeText(candidate.product_title) ||
      normalizeText(candidate.medusa_product_title)
    const mappingSource =
      normalizeText(candidate.mapping_source) ||
      "existing_legacy_item_map_backfill"
    const confidence = toNumber(candidate.confidence) || 1

    if (stats.samples.length < sampleLimit) {
      stats.samples.push({
        status: apply ? "backfilled" : "would_backfill",
        qbd_item_list_id: candidate.qbd_item_list_id,
        sku: candidate.sku,
        medusa_variant_id: candidate.variant_id,
        stale_product_line_count: productStaleCount,
      })
    }

    if (!apply) {
      continue
    }

    let updatedForMap = 0
    for (const rowsChunk of chunk(productRows, batchSize)) {
      const ids = rowsChunk.map((row: any) => row.id).filter(Boolean)
      if (!ids.length) {
        continue
      }

      const updated = await db("legacy_order_line")
        .whereIn("id", ids)
        .update({
          medusa_product_id: medusaProductId,
          medusa_variant_id: candidate.variant_id,
          medusa_product_title: medusaProductTitle,
          medusa_variant_title: medusaVariantTitle,
          mapping_status: "mapped",
          metadata: db.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
            JSON.stringify({
              line_kind: "product",
              mapping_confidence: confidence,
              mapping_source: mappingSource,
              mapping_imported_from: "backfill-existing-legacy-item-maps",
              existing_legacy_item_map_id: candidate.item_map_id,
            }),
          ]),
          updated_at: now,
        })

      updatedForMap += Number(updated) || 0
    }

    await db("legacy_item_map")
      .where({ id: candidate.item_map_id })
      .update({
        last_seen_at: now,
        metadata: db.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
          JSON.stringify({
            last_backfilled_by: "backfill-existing-legacy-item-maps",
            last_backfilled_at: now.toISOString(),
            last_backfilled_line_count: updatedForMap,
          }),
        ]),
        updated_at: now,
      })

    stats.mapsBackfilled += 1
    stats.rowsBackfilled += updatedForMap
  }

  logger.info(
    `[existing-legacy-item-map-backfill] ${apply ? "applied" : "dry-run"} ${JSON.stringify(stats)}`
  )
}
