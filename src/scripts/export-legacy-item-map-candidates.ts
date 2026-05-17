import path from "path"
import { writeFile } from "fs/promises"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  getNumberArg,
  getStringArg,
  parseArgs,
  toNumber,
  toText,
} from "./lib/legacy-import-utils"

type LegacyItemSummary = {
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  sample_description: string | null
  line_count: number
  description_count: number
  last_ordered_at: string | null
}

type VariantRow = {
  variant_id: string
  product_id: string | null
  sku: string | null
  variant_title: string | null
  product_title: string | null
  variant_metadata: Record<string, unknown> | null
  product_metadata: Record<string, unknown> | null
}

type Candidate = {
  item: LegacyItemSummary
  variant: VariantRow
  score: number
  reasons: string[]
}

const STOP_WORDS = new Set([
  "a",
  "aka",
  "all",
  "and",
  "are",
  "at",
  "available",
  "brand",
  "by",
  "case",
  "contains",
  "for",
  "free",
  "from",
  "in",
  "is",
  "kosher",
  "lb",
  "lbs",
  "meat",
  "new",
  "no",
  "not",
  "of",
  "on",
  "or",
  "oz",
  "packed",
  "pack",
  "pareve",
  "per",
  "produced",
  "round",
  "serve",
  "serves",
  "supervision",
  "the",
  "to",
  "uncooked",
  "vacuum",
  "with",
  "year",
])

function normalizeLookupValue(value: unknown) {
  return toText(value)?.toLowerCase() ?? null
}

function normalizeSkuValue(value: unknown) {
  return normalizeLookupValue(value)?.replace(/[^a-z0-9]/g, "") ?? null
}

function normalizeSearchText(value: unknown) {
  return (
    normalizeLookupValue(value)
      ?.replace(/&/g, " and ")
      .replace(/\$/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  )
}

function legacySkuAliases(value: unknown) {
  const text = toText(value)
  if (!text) {
    return []
  }

  const aliases = new Set<string>()
  const addAlias = (candidate: string | null | undefined) => {
    const normalized = toText(candidate)
    if (!normalized) {
      return
    }

    aliases.add(normalized)
    const trailingPassoverSuffix = normalized.match(/^(.+-[A-Z0-9]+)P$/i)
    if (trailingPassoverSuffix?.[1]) {
      aliases.add(trailingPassoverSuffix[1])
    }
  }

  addAlias(text)

  const legacyLifecyclePrefix = text.match(/^[XYZ]-(.+)$/i)
  if (legacyLifecyclePrefix?.[1]) {
    addAlias(legacyLifecyclePrefix[1])
  }

  return Array.from(aliases)
}

function extractSkuLikeValues(value: unknown) {
  const text = toText(value)
  if (!text) {
    return []
  }

  return (text.match(/\b[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,8}){1,5}\b/gi) ?? [])
    .filter((candidate) => /[a-z]/i.test(candidate))
}

function metadataValues(metadata: unknown, keys: string[]) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return []
  }

  const record = metadata as Record<string, unknown>
  return keys
    .flatMap((key) => {
      const value = record[key]
      return Array.isArray(value) ? value : [value]
    })
    .map(toText)
    .filter(Boolean) as string[]
}

function tokenSet(value: unknown) {
  const tokens = normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))

  return new Set(tokens)
}

function tokenSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return 0
  }

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1
    }
  }

  return intersection / (left.size + right.size - intersection)
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

function scoreCandidate(item: LegacyItemSummary, variant: VariantRow): Candidate | null {
  const reasons: string[] = []
  let score = 0
  const legacySkuCandidates = legacySkuAliases(item.sku)
  const variantSku = normalizeSkuValue(variant.sku)

  if (variantSku) {
    for (const candidate of legacySkuCandidates) {
      if (normalizeSkuValue(candidate) === variantSku) {
        score = Math.max(score, 0.98)
        reasons.push("sku_alias_exact")
      }
    }
  }

  const descriptionSkuCandidates = extractSkuLikeValues(item.sample_description)
  if (variantSku) {
    for (const candidate of descriptionSkuCandidates) {
      const normalizedCandidate = normalizeSkuValue(candidate)
      if (normalizedCandidate && variantSku.endsWith(normalizedCandidate)) {
        score = Math.max(score, 0.95)
        reasons.push("description_sku_variant_suffix_exact")
      }
    }
  }

  const legacyMetadataKeys = [
    "qbd_item_list_id",
    "qbdItemListId",
    "quickbooks_item_id",
    "quickbooksItemId",
    "quickbooks_list_id",
    "quickbooksListId",
    "legacy_item_id",
    "legacyItemId",
    "legacy_sku",
    "legacySku",
    "item_code",
    "itemCode",
    "sku",
  ]
  const legacyValues = [
    ...metadataValues(variant.variant_metadata, legacyMetadataKeys),
    ...metadataValues(variant.product_metadata, legacyMetadataKeys),
  ].map(normalizeSkuValue)
  const itemValues = [
    item.qbd_item_list_id,
    item.sku,
    ...legacySkuCandidates,
  ].map(normalizeSkuValue)

  if (
    itemValues.some((value) => value && legacyValues.includes(value))
  ) {
    score = Math.max(score, 0.99)
    reasons.push("legacy_metadata_exact")
  }

  const legacyText = [
    item.title,
    item.sample_description,
  ].filter(Boolean).join(" ")
  const variantText = [
    variant.sku,
    variant.variant_title,
    variant.product_title,
  ].filter(Boolean).join(" ")
  const legacyTokens = tokenSet(legacyText)
  const variantTokens = tokenSet(variantText)
  const similarity = tokenSimilarity(legacyTokens, variantTokens)

  if (similarity >= 0.28) {
    score = Math.max(score, 0.45 + similarity * 0.5)
    reasons.push(`token_similarity:${similarity.toFixed(3)}`)
  }

  const normalizedLegacyDescription = normalizeSearchText(item.sample_description)
  const normalizedProductTitle = normalizeSearchText(variant.product_title)
  if (
    normalizedProductTitle.length >= 16 &&
    normalizedLegacyDescription.includes(normalizedProductTitle)
  ) {
    score = Math.max(score, 0.86)
    reasons.push("product_title_contained")
  }

  if (!score) {
    return null
  }

  return {
    item,
    variant,
    score: Number(score.toFixed(4)),
    reasons,
  }
}

async function loadUnmappedLegacyItems(db: any, limit: number, minLines: number) {
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
    .where("lol.mapping_status", "unmapped")
    .groupBy(["lol.qbd_item_list_id", "lol.sku", "lol.title"])
    .havingRaw("count(*) >= ?", [minLines])
    .orderBy("line_count", "desc")
    .limit(limit)

  return rows.map((row: any) => ({
    qbd_item_list_id: toText(row.qbd_item_list_id),
    sku: toText(row.sku),
    title: toText(row.title),
    sample_description: toText(row.sample_description),
    line_count: toNumber(row.line_count),
    description_count: toNumber(row.description_count),
    last_ordered_at: row.last_ordered_at
      ? new Date(row.last_ordered_at).toISOString()
      : null,
  })) as LegacyItemSummary[]
}

async function loadVariants(db: any) {
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
    }) as Promise<VariantRow[]>
}

function renderCsv(candidates: Candidate[]) {
  const header = [
    "review_status",
    "score",
    "reasons",
    "qbd_item_list_id",
    "sku",
    "legacy_title",
    "sample_description",
    "line_count",
    "description_count",
    "last_ordered_at",
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
      const reviewStatus =
        candidate.score >= 0.97 &&
        candidate.item.description_count === 1 &&
        candidate.reasons.some((reason) => reason.endsWith("_exact"))
          ? "high_confidence"
          : "review_required"
      return csvRow([
        reviewStatus,
        candidate.score,
        candidate.reasons.join(";"),
        candidate.item.qbd_item_list_id,
        candidate.item.sku,
        candidate.item.title,
        candidate.item.sample_description,
        candidate.item.line_count,
        candidate.item.description_count,
        candidate.item.last_ordered_at,
        "",
        candidate.variant.variant_id,
        candidate.variant.sku,
        candidate.variant.product_id,
        candidate.variant.product_title,
        candidate.variant.variant_title,
        candidate.score,
        "candidate_export",
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
  const output = getStringArg(args, ["output", "file"]) ||
    `legacy-item-map-candidates-${new Date().toISOString().slice(0, 10)}.csv`

  const [items, variants] = await Promise.all([
    loadUnmappedLegacyItems(db, limit, minLines),
    loadVariants(db),
  ])

  const candidates = items.flatMap((item) =>
    variants
      .map((variant) => scoreCandidate(item, variant))
      .filter((candidate): candidate is Candidate =>
        Boolean(candidate && candidate.score >= minScore)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, candidatesPerItem)
  )

  const outputPath = path.resolve(process.cwd(), output)
  await writeFile(outputPath, `${renderCsv(candidates)}\n`, "utf8")

  logger.info(
    `[legacy-item-map-candidates] exported ${JSON.stringify({
      output: outputPath,
      unmappedItemsReviewed: items.length,
      variantsCompared: variants.length,
      candidates: candidates.length,
      highConfidence: candidates.filter((candidate) =>
        candidate.score >= 0.97 &&
        candidate.item.description_count === 1 &&
        candidate.reasons.some((reason) => reason.endsWith("_exact"))
      ).length,
    })}`
  )
}
