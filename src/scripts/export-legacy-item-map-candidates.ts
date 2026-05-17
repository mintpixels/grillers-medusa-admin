import path from "path"
import { writeFile } from "fs/promises"
import Conductor from "conductor-node"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
  variant: VariantRow | null
  score: number
  reasons: string[]
  identity_warnings: string[]
}

type IdentityGroup = {
  name: string
  terms: Array<{
    key: string
    patterns: RegExp[]
  }>
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

const IDENTITY_GROUPS: IdentityGroup[] = [
  {
    name: "poultry_part",
    terms: [
      { key: "8_piece_cut_up", patterns: [/\b(?:8|eight)[-\s]*(?:pce|pc|piece|pieces)\b/i, /\bcut[-\s]?up\b/i] },
      { key: "whole", patterns: [/\bwhole\b/i] },
      { key: "neck", patterns: [/\bnecks?\b/i] },
      { key: "wing", patterns: [/\bwings?\b/i] },
      { key: "drumette", patterns: [/\bdrumettes?\b/i] },
      { key: "drumstick", patterns: [/\bdrumsticks?\b/i] },
      { key: "leg_quarter", patterns: [/\bleg quarters?\b/i] },
      { key: "thigh", patterns: [/\bthighs?\b/i] },
      { key: "breast", patterns: [/\bbreasts?\b/i] },
      { key: "liver", patterns: [/\blivers?\b/i] },
      { key: "bone", patterns: [/\bbones?\b/i] },
      { key: "ground", patterns: [/\bground\b/i] },
      { key: "schnitzel", patterns: [/\bschnitzel\b/i] },
      { key: "cutlet", patterns: [/\bcutlets?\b/i] },
      { key: "tender", patterns: [/\btenders?\b/i] },
    ],
  },
  {
    name: "beef_lamb_cut",
    terms: [
      { key: "london_broil", patterns: [/\blondon broil\b/i] },
      { key: "brisket", patterns: [/\bbrisket\b/i] },
      { key: "deckel", patterns: [/\bdeckel\b/i] },
      { key: "short_rib", patterns: [/\bshort ribs?\b/i] },
      { key: "flanken", patterns: [/\bflanken\b/i] },
      { key: "ribeye", patterns: [/\bribeye\b/i] },
      { key: "oyster", patterns: [/\boyster steak\b/i] },
      { key: "strip_denver", patterns: [/\bstrip steak\b/i, /\bdenver steak\b/i] },
      { key: "chuckeye_delmonico", patterns: [/\bchuckeye\b/i, /\bdelmonico\b/i] },
      { key: "biltong_jerky", patterns: [/\bbiltong\b/i, /\bbeef jerky\b/i] },
      { key: "dry_wors", patterns: [/\bdry wors\b/i, /\bdried sausage\b/i] },
      { key: "liver", patterns: [/\bliver\b/i] },
      { key: "pepper_steak", patterns: [/\bpepper steak\b/i] },
      { key: "minute_steak", patterns: [/\bminute steak\b/i] },
      { key: "kebab", patterns: [/\bkebabs?\b/i] },
    ],
  },
  {
    name: "prepared_item",
    terms: [
      { key: "pot_pie", patterns: [/\bpot pie\b/i] },
      { key: "pocket_pie", patterns: [/\bpocket pies?\b/i] },
      { key: "matzo_ball", patterns: [/\bmatzo balls?\b/i] },
      { key: "butternut_souffle", patterns: [/\bbutternut souffle\b/i] },
      { key: "corn_souffle", patterns: [/\bcorn souffle\b/i] },
      { key: "kugel", patterns: [/\bkugel\b/i] },
      { key: "gravy", patterns: [/\bgravy\b/i] },
      { key: "stuffing_dressing", patterns: [/\bstuffing\b/i, /\bdressing\b/i] },
      { key: "orange_chicken", patterns: [/\borange chicken\b/i] },
      { key: "meatballs", patterns: [/\bmeat ?balls?\b/i] },
      { key: "katsu", patterns: [/\bkatsu\b/i] },
      { key: "pulled_chicken", patterns: [/\bpulled chicken\b/i] },
      { key: "smoked_salmon", patterns: [/\bsmoked salmon\b/i] },
      { key: "turkey_pastrami", patterns: [/\bturkey pastrami\b/i] },
    ],
  },
  {
    name: "brand_or_program",
    terms: [
      { key: "david_elliot", patterns: [/\bdavid elliot\b/i] },
      { key: "empire", patterns: [/\bempire\b/i] },
      { key: "aarons", patterns: [/\baarons?\b/i] },
      { key: "organic", patterns: [/\borganic\b/i] },
      { key: "antibiotic_free", patterns: [/\bantibiotic[-\s]?free\b/i] },
      { key: "grass_fed", patterns: [/\bgrass[-\s]?fed\b/i] },
      { key: "american_angus", patterns: [/\bamerican angus\b/i] },
      { key: "haolam", patterns: [/\bhaolam\b/i] },
      { key: "bgan", patterns: [/\bb'?gan\b/i] },
    ],
  },
]

function extractIdentityKeys(value: unknown, group: IdentityGroup) {
  const text = String(value ?? "")
  const keys = new Set<string>()

  for (const term of group.terms) {
    if (term.patterns.some((pattern) => pattern.test(text))) {
      keys.add(term.key)
    }
  }

  return keys
}

function setIntersects(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) {
      return true
    }
  }
  return false
}

function passoverStatus(value: unknown) {
  const text = normalizeSearchText(value)
  if (!text) {
    return null
  }

  if (/\bnot (?:kosher for passover|kfp)\b/.test(text)) {
    return "not_kfp"
  }
  if (/\b(?:kosher for passover|kfp)\b/.test(text)) {
    return "kfp"
  }

  return null
}

function identityWarnings(legacyText: string, candidateText: string) {
  const warnings: string[] = []
  const legacyPassoverStatus = passoverStatus(legacyText)
  const candidatePassoverStatus = passoverStatus(candidateText)
  if (
    legacyPassoverStatus &&
    candidatePassoverStatus &&
    legacyPassoverStatus !== candidatePassoverStatus
  ) {
    warnings.push(
      `passover_status:${legacyPassoverStatus}->${candidatePassoverStatus}`
    )
  }

  for (const group of IDENTITY_GROUPS) {
    const legacyKeys = extractIdentityKeys(legacyText, group)
    const candidateKeys = extractIdentityKeys(candidateText, group)
    if (
      legacyKeys.size &&
      candidateKeys.size &&
      !setIntersects(legacyKeys, candidateKeys)
    ) {
      warnings.push(
        `${group.name}:${Array.from(legacyKeys).sort().join("+")}->${Array.from(candidateKeys).sort().join("+")}`
      )
    }
  }

  return warnings
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

  const warnings = identityWarnings(legacyText, variantText)
  const hasExactReason = reasons.some((reason) => reason.endsWith("_exact"))
  if (warnings.length && !hasExactReason) {
    return null
  }

  if (warnings.length) {
    score = Math.min(score, 0.94)
  }

  return {
    item,
    variant,
    score: Number(score.toFixed(4)),
    reasons,
    identity_warnings: warnings,
  }
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
    const itemCandidates = variants
      .map((variant) => scoreCandidate(item, variant))
      .filter((candidate): candidate is Candidate =>
        Boolean(candidate && candidate.score >= minScore)
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, candidatesPerItem)
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
