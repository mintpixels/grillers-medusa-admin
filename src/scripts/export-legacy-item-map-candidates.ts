import path from "path"
import { writeFile } from "fs/promises"
import Conductor from "conductor-node"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  type LegacyItemMappingSuggestion,
  type LegacyItemSuggestionVariantRow,
  suggestLegacyItemMappingsFromVariants,
} from "../lib/legacy-item-candidate-suggestions"
import {
  getBooleanArg,
  getNumberArg,
  getStringArg,
  loadFirstExistingEnvFile,
  parseArgs,
  toNumber,
  toText,
} from "./lib/legacy-import-utils"

type LegacyDescriptionSummary = {
  description: string | null
  line_count: number
  last_ordered_at: string | null
}

type QbdItemFact = {
  type: string
  id: string
  name: string | null
  full_name: string | null
  is_active: boolean | null
  sales_description: string | null
  sales_price: string | null
}

type LegacyItemSummary = {
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  sample_description: string | null
  top_descriptions: LegacyDescriptionSummary[]
  line_count: number
  description_count: number
  last_ordered_at: string | null
  qbd_item: QbdItemFact | null
}

type Candidate = {
  item: LegacyItemSummary
  variant: LegacyItemMappingSuggestion | null
  score: number
  reasons: string[]
  identity_warnings: string[]
}

function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  if (!/[",\n\r]/.test(text)) {
    return text
  }

  return `"${text.replace(/"/g, '""')}"`
}

function csvRow(values: unknown[]) {
  return values.map(csvCell).join(",")
}

function itemKey(value: {
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
}) {
  return [
    value.qbd_item_list_id ?? "",
    value.sku ?? "",
    value.title ?? "",
  ].join("\u001f")
}

function renderTopDescriptions(descriptions: LegacyDescriptionSummary[]) {
  return descriptions
    .map((description) => {
      const text = description.description || "(blank)"
      return `${description.line_count}x ${text}`
    })
    .join(" | ")
}

function salesDescription(item: any) {
  return toText(
    item.salesOrPurchaseDetails?.description ??
      item.salesAndPurchaseDetails?.salesDescription ??
      item.description
  )
}

function salesPrice(item: any) {
  return toText(
    item.salesOrPurchaseDetails?.price ??
      item.salesAndPurchaseDetails?.salesPrice ??
      item.salesPrice
  )
}

async function loadUnmappedLegacyItems(
  db: any,
  limit: number,
  minLines: number,
  descriptionSamples: number
) {
  const rows = await db("legacy_order_line as lol")
    .leftJoin("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .select([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      db.raw("min(lol.description) as sample_description"),
      db.raw("count(*)::int as line_count"),
      db.raw("count(distinct coalesce(lol.description, ''))::int as description_count"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
    .groupBy(["lol.qbd_item_list_id", "lol.sku", "lol.title"])
    .havingRaw("count(*) >= ?", [minLines])
    .orderBy("line_count", "desc")
    .limit(limit)

  const items = rows.map((row: any) => ({
    qbd_item_list_id: toText(row.qbd_item_list_id),
    sku: toText(row.sku),
    title: toText(row.title),
    sample_description: toText(row.sample_description),
    top_descriptions: [],
    line_count: toNumber(row.line_count),
    description_count: toNumber(row.description_count),
    last_ordered_at: row.last_ordered_at
      ? new Date(row.last_ordered_at).toISOString()
      : null,
    qbd_item: null,
  })) as LegacyItemSummary[]

  const topDescriptionsByItem = await loadTopDescriptions(
    db,
    items,
    descriptionSamples
  )
  return items.map((item) => {
    const topDescriptions = topDescriptionsByItem.get(itemKey(item)) ?? []
    return {
      ...item,
      sample_description:
        topDescriptions[0]?.description ?? item.sample_description,
      top_descriptions: topDescriptions,
    }
  })
}

async function loadTopDescriptions(
  db: any,
  items: LegacyItemSummary[],
  descriptionSamples: number
) {
  if (!items.length || descriptionSamples <= 0) {
    return new Map<string, LegacyDescriptionSummary[]>()
  }

  const wantedKeys = new Set(items.map(itemKey))
  const rows = await db("legacy_order_line as lol")
    .leftJoin("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .select([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      "lol.description",
      db.raw("count(*)::int as line_count"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
    .groupBy([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      "lol.description",
    ])
    .orderBy("line_count", "desc")

  const byItem = new Map<string, LegacyDescriptionSummary[]>()
  for (const row of rows) {
    const key = itemKey({
      qbd_item_list_id: toText(row.qbd_item_list_id),
      sku: toText(row.sku),
      title: toText(row.title),
    })
    if (!wantedKeys.has(key)) {
      continue
    }

    const descriptions = byItem.get(key) ?? []
    if (descriptions.length >= descriptionSamples) {
      continue
    }

    descriptions.push({
      description: toText(row.description),
      line_count: toNumber(row.line_count),
      last_ordered_at: row.last_ordered_at
        ? new Date(row.last_ordered_at).toISOString()
        : null,
    })
    byItem.set(key, descriptions)
  }

  return byItem
}

async function maybeLoadQbdItemFacts({
  items,
  includeQbdItems,
  qbdItemLimit,
  logger,
}: {
  items: LegacyItemSummary[]
  includeQbdItems: boolean
  qbdItemLimit: number
  logger: any
}) {
  const facts = new Map<string, QbdItemFact>()
  if (!includeQbdItems || qbdItemLimit <= 0) {
    return facts
  }

  let apiKey = process.env.CONDUCTOR_SECRET_KEY || process.env.CONDUCTOR_API_KEY
  if (!apiKey || !process.env.CONDUCTOR_END_USER_ID) {
    loadFirstExistingEnvFile(["../grillerspride/.env"])
    apiKey = process.env.CONDUCTOR_SECRET_KEY || process.env.CONDUCTOR_API_KEY
  }

  const conductorEndUserId = process.env.CONDUCTOR_END_USER_ID
  if (!apiKey || !conductorEndUserId) {
    logger.warn?.(
      "[legacy-item-map-candidates] --include-qbd-items skipped because Conductor env is missing"
    )
    return facts
  }

  const conductor = new Conductor({ apiKey })
  const qbdIds = Array.from(
    new Set(items.map((item) => item.qbd_item_list_id).filter(Boolean))
  ).slice(0, qbdItemLimit) as string[]
  const resources = [
    "inventoryItems",
    "nonInventoryItems",
    "serviceItems",
    "itemGroups",
    "otherChargeItems",
  ]

  for (const qbdId of qbdIds) {
    for (const resource of resources) {
      try {
        const item = await (conductor.qbd as any)[resource].retrieve(qbdId, {
          conductorEndUserId,
        })
        facts.set(qbdId, {
          type: resource,
          id: toText(item.id) ?? qbdId,
          name: toText(item.name),
          full_name: toText(item.fullName),
          is_active:
            typeof item.isActive === "boolean" ? item.isActive : null,
          sales_description: salesDescription(item),
          sales_price: salesPrice(item),
        })
        break
      } catch (error) {
        const status = (error as any)?.status
        if (status && ![400, 404, 502].includes(status)) {
          logger.warn?.(
            `[legacy-item-map-candidates] QBD lookup failed id=${qbdId} resource=${resource}: ${
              (error as Error).message
            }`
          )
        }
      }
    }
  }

  return facts
}

async function loadVariants(db: any): Promise<LegacyItemSuggestionVariantRow[]> {
  return db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "pv.metadata as variant_metadata",
      "p.title as product_title",
      "p.metadata as product_metadata",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder.whereNull("p.deleted_at").orWhereNull("p.id")
    }) as Promise<LegacyItemSuggestionVariantRow[]>
}

function unmatchedCandidate(item: LegacyItemSummary): Candidate {
  return {
    item,
    variant: null,
    score: 0,
    reasons: ["no_candidate_above_threshold"],
    identity_warnings: [],
  }
}

function renderCsv(candidates: Candidate[]) {
  const header = [
    "review_status",
    "score",
    "reasons",
    "identity_warnings",
    "qbd_item_list_id",
    "sku",
    "legacy_title",
    "sample_description",
    "top_descriptions",
    "line_count",
    "description_count",
    "last_ordered_at",
    "qbd_item_type",
    "qbd_item_name",
    "qbd_item_full_name",
    "qbd_item_active",
    "qbd_item_sales_description",
    "qbd_item_sales_price",
    "candidate_description_contains",
    "candidate_medusa_variant_id",
    "candidate_medusa_sku",
    "candidate_medusa_product_id",
    "candidate_medusa_product_title",
    "candidate_medusa_variant_title",
    "candidate_confidence",
    "candidate_mapping_source",
    "notes",
  ]

  return [
    csvRow(header),
    ...candidates.map((candidate) => {
      const reviewStatus = !candidate.variant
        ? "no_candidate"
        : candidate.identity_warnings.length
          ? "review_required"
          : candidate.score >= 0.97 &&
        candidate.item.description_count === 1 &&
        candidate.reasons.some((reason) => reason.endsWith("_exact"))
          ? "high_confidence"
          : "review_required"
      return csvRow([
        reviewStatus,
        candidate.score || "",
        candidate.reasons.join(";"),
        candidate.identity_warnings.join(";"),
        candidate.item.qbd_item_list_id,
        candidate.item.sku,
        candidate.item.title,
        candidate.item.sample_description,
        renderTopDescriptions(candidate.item.top_descriptions),
        candidate.item.line_count,
        candidate.item.description_count,
        candidate.item.last_ordered_at,
        candidate.item.qbd_item?.type,
        candidate.item.qbd_item?.name,
        candidate.item.qbd_item?.full_name,
        candidate.item.qbd_item?.is_active,
        candidate.item.qbd_item?.sales_description,
        candidate.item.qbd_item?.sales_price,
        "",
        candidate.variant?.variant_id,
        candidate.variant?.sku,
        candidate.variant?.product_id,
        candidate.variant?.product_title,
        candidate.variant?.variant_title,
        candidate.score || "",
        candidate.variant ? "candidate_export" : "",
        "",
      ])
    }),
  ].join("\n")
}

export default async function exportLegacyItemMapCandidates({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const limit = getNumberArg(args, ["limit"], 250)
  const minLines = getNumberArg(args, ["min-lines"], 10)
  const minScore = getNumberArg(args, ["min-score"], 0.58)
  const candidatesPerItem = getNumberArg(args, ["candidates-per-item"], 3)
  const descriptionSamples = getNumberArg(args, ["description-samples"], 5)
  const includeQbdItems = getBooleanArg(args, ["include-qbd-items"], false)
  const includeUnmatched = getBooleanArg(args, ["include-unmatched"], true)
  const qbdItemLimit = getNumberArg(args, ["qbd-item-limit"], limit)
  const output = getStringArg(args, ["output", "file"]) ||
    `legacy-item-map-candidates-${new Date().toISOString().slice(0, 10)}.csv`

  const [loadedItems, variants] = await Promise.all([
    loadUnmappedLegacyItems(db, limit, minLines, descriptionSamples),
    loadVariants(db),
  ])
  const qbdItemFacts = await maybeLoadQbdItemFacts({
    items: loadedItems,
    includeQbdItems,
    qbdItemLimit,
    logger,
  })
  const items = loadedItems.map((item) => ({
    ...item,
    qbd_item: item.qbd_item_list_id
      ? qbdItemFacts.get(item.qbd_item_list_id) ?? null
      : null,
    top_descriptions: item.top_descriptions.slice(0, descriptionSamples),
  }))

  const candidates = items.flatMap((item) => {
    const itemCandidates = suggestLegacyItemMappingsFromVariants(item, variants, {
      limit: candidatesPerItem,
      minScore,
    }).map((suggestion) => ({
      item,
      variant: suggestion,
      score: suggestion.score,
      reasons: suggestion.reasons,
      identity_warnings: suggestion.identity_warnings,
    }))
    return itemCandidates.length || !includeUnmatched
      ? itemCandidates
      : [unmatchedCandidate(item)]
  })

  const outputPath = path.resolve(process.cwd(), output)
  await writeFile(outputPath, `${renderCsv(candidates)}\n`, "utf8")

  logger.info(
    `[legacy-item-map-candidates] exported ${JSON.stringify({
      output: outputPath,
      unmappedItemsReviewed: items.length,
      variantsCompared: variants.length,
      candidates: candidates.length,
      unmatched: candidates.filter((candidate) => !candidate.variant).length,
      identityWarnings: candidates.filter(
        (candidate) => candidate.identity_warnings.length
      ).length,
      qbdItemFacts: qbdItemFacts.size,
      highConfidence: candidates.filter((candidate) =>
        candidate.score >= 0.97 &&
        candidate.item.description_count === 1 &&
        candidate.reasons.some((reason) => reason.endsWith("_exact")) &&
        !candidate.identity_warnings.length
      ).length,
    })}`
  )
}
