import crypto from "node:crypto"
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import {
  retrieveQbdItemFact,
  type QbdItemFact,
} from "../lib/legacy-qbd-item-facts"
import { upsertLegacyItemMapping } from "../lib/legacy-item-mapping"
import {
  getBooleanArg,
  getNumberArg,
  parseArgs,
  toNumber,
  toText,
} from "./lib/legacy-import-utils"

type KnexLike = any

type CandidateRow = {
  qbd_item_list_id: string
  sku: string | null
  title: string | null
  sample_description: string | null
  line_count: string | number
  order_count: string | number
  customer_count: string | number
  total_quantity: string | number
  latest_unit_price: string | number | null
  average_unit_price: string | number | null
  last_ordered_at: string | Date | null
  last_order_ref: string | null
  generic_line_count: string | number
  description_count: string | number
}

type VariantTarget = {
  variant_id: string
  sku: string | null
  variant_title: string | null
  product_id: string | null
  product_title: string | null
}

const SUPPORTED_QBD_PRODUCT_TYPES = new Set([
  "inventoryItems",
  "nonInventoryItems",
  "itemGroups",
])

const GENERIC_TITLE_VALUES = [
  "misc item",
  "miscellaneous item",
  "miscellanous item",
  "misc services",
  "misc service",
]

function normalizeText(value: unknown): string | null {
  return toText(value)
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isGenericTitle(value: unknown) {
  return GENERIC_TITLE_VALUES.includes(normalizeSearchText(value))
}

function isNonMerchandiseReorderItem(
  candidate: CandidateRow,
  qbdItem?: QbdItemFact | null
) {
  const blob = [
    candidate.sku,
    candidate.title,
    candidate.sample_description,
    qbdItem?.name,
    qbdItem?.full_name,
    qbdItem?.sales_description,
  ]
    .map(normalizeSearchText)
    .filter(Boolean)
    .join(" ")

  return (
    /\bgift\s+(certificate|cert|voucher|card)\b/.test(blob) ||
    /\b(certificate|voucher)\s+\d+\b/.test(blob) ||
    /\bdonation\b/.test(blob) ||
    /\btzedakah\b/.test(blob)
  )
}

function genericTitleSql(alias = "lol") {
  const normalizedTitle = `btrim(regexp_replace(lower(coalesce(${alias}.title, '')), '[^a-z0-9]+', ' ', 'g'))`
  const normalizedSku = `btrim(regexp_replace(lower(coalesce(${alias}.sku, '')), '[^a-z0-9]+', ' ', 'g'))`
  const values = GENERIC_TITLE_VALUES.map((value) => `'${value}'`).join(", ")

  return `(${normalizedTitle} in (${values}) or ${normalizedSku} in (${values}))`
}

function countNumber(value: unknown) {
  return toNumber(value)
}

function positivePrice(value: unknown): number | null {
  const normalized =
    typeof value === "string" ? value.replace(/[$,]/g, "").trim() : value
  const price = toNumber(normalized)

  if (!Number.isFinite(price) || price <= 0) {
    return null
  }

  return Math.round(price * 100) / 100
}

function selectedPrice(candidate: CandidateRow, qbdItem: QbdItemFact | null) {
  const qbdSalesPrice = positivePrice(qbdItem?.sales_price)
  if (qbdSalesPrice !== null) {
    return { amount: qbdSalesPrice, source: "qbd_sales_price" }
  }

  const latestHistoricalPrice = positivePrice(candidate.latest_unit_price)
  if (latestHistoricalPrice !== null) {
    return { amount: latestHistoricalPrice, source: "latest_historical_unit_price" }
  }

  const averageHistoricalPrice = positivePrice(candidate.average_unit_price)
  if (averageHistoricalPrice !== null) {
    return { amount: averageHistoricalPrice, source: "average_historical_unit_price" }
  }

  return null
}

function stableHash(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 10)
}

function slugPart(value: string, maxLength = 70) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return (slug || "item").slice(0, maxLength).replace(/-+$/g, "")
}

function legacyProductHandle(qbdItemListId: string) {
  return `legacy-reorder-${slugPart(qbdItemListId, 80)}-${stableHash(
    qbdItemListId
  )}`
}

function legacyVariantSku(qbdItemListId: string) {
  const normalized = qbdItemListId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "")

  return `LQBD-${normalized || "ITEM"}-${stableHash(qbdItemListId).toUpperCase()}`
}

function titleFromCandidate(candidate: CandidateRow, qbdItem: QbdItemFact | null) {
  return (
    normalizeText(qbdItem?.sales_description) ||
    normalizeText(candidate.sample_description) ||
    normalizeText(qbdItem?.full_name) ||
    normalizeText(candidate.title) ||
    normalizeText(candidate.sku) ||
    "Legacy reorder item"
  )
}

function itemName(candidate: CandidateRow, qbdItem: QbdItemFact | null) {
  return (
    normalizeText(qbdItem?.full_name) ||
    normalizeText(qbdItem?.name) ||
    normalizeText(candidate.title) ||
    normalizeText(candidate.sku)
  )
}

function isLegacyReorderMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const flag = (value as Record<string, unknown>).legacy_reorder_only
  return flag === true || String(flag).toLowerCase() === "true"
}

function sample(stats: Record<string, unknown[]>, key: string, value: unknown, limit: number) {
  const bucket = stats[key] ?? []
  if (bucket.length < limit) {
    bucket.push(value)
  }
  stats[key] = bucket
}

async function listCandidates(
  db: KnexLike,
  input: { limit: number; offset: number; minLines: number }
): Promise<CandidateRow[]> {
  const genericSql = genericTitleSql("lol")

  return db("legacy_order_line as lol")
    .join("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .select([
      "lol.qbd_item_list_id",
      db.raw(
        "(array_agg(nullif(lol.sku, '') order by lo.placed_at desc nulls last) filter (where nullif(lol.sku, '') is not null))[1] as sku"
      ),
      db.raw(
        "(array_agg(nullif(lol.title, '') order by lo.placed_at desc nulls last) filter (where nullif(lol.title, '') is not null))[1] as title"
      ),
      db.raw(
        "(array_agg(nullif(lol.description, '') order by lo.placed_at desc nulls last) filter (where nullif(lol.description, '') is not null))[1] as sample_description"
      ),
      db.raw("count(*) as line_count"),
      db.raw("count(distinct lol.legacy_order_id) as order_count"),
      db.raw("count(distinct lo.medusa_customer_id) as customer_count"),
      db.raw("coalesce(sum(lol.quantity), 0) as total_quantity"),
      db.raw(
        "(array_agg(nullif(lol.unit_price, 0) order by lo.placed_at desc nulls last) filter (where coalesce(lol.unit_price, 0) > 0))[1] as latest_unit_price"
      ),
      db.raw("avg(nullif(lol.unit_price, 0)) as average_unit_price"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
      db.raw(
        "(array_agg(coalesce(lo.ref_number, lo.qbd_txn_id) order by lo.placed_at desc nulls last))[1] as last_order_ref"
      ),
      db.raw(`count(*) filter (where ${genericSql}) as generic_line_count`),
      db.raw(
        "count(distinct coalesce(nullif(btrim(lol.description), ''), '__blank__')) as description_count"
      ),
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
    .whereNotNull("lol.qbd_item_list_id")
    .andWhere((builder: any) => {
      builder
        .whereRaw("coalesce(lol.metadata->>'line_kind', 'product') = 'product'")
        .orWhereNull("lol.metadata")
    })
    .groupBy("lol.qbd_item_list_id")
    .havingRaw("count(*) >= ?", [input.minLines])
    .orderByRaw("count(*) desc")
    .orderByRaw("max(lo.placed_at) desc nulls last")
    .limit(input.limit)
    .offset(input.offset)
}

async function defaultShippingProfileId(db: KnexLike) {
  const row = await db("shipping_profile")
    .select("id")
    .whereNull("deleted_at")
    .orderByRaw("case when type = 'default' then 0 else 1 end")
    .orderBy("created_at", "asc")
    .first()

  return normalizeText(row?.id)
}

async function existingItemMap(db: KnexLike, qbdItemListId: string) {
  return db("legacy_item_map")
    .select(["id", "medusa_variant_id"])
    .where("qbd_item_list_id", qbdItemListId)
    .whereNotNull("medusa_variant_id")
    .whereNull("deleted_at")
    .first()
}

async function existingLegacyReorderVariant(
  db: KnexLike,
  qbdItemListId: string
): Promise<VariantTarget | null> {
  const row = await db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "p.title as product_title",
      "pv.metadata as variant_metadata",
      "p.metadata as product_metadata",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder.whereNull("p.deleted_at").orWhereNull("p.id")
    })
    .andWhere((builder: any) => {
      builder
        .whereRaw("pv.metadata->>'qbd_item_list_id' = ?", [qbdItemListId])
        .orWhereRaw("p.metadata->>'qbd_item_list_id' = ?", [qbdItemListId])
    })
    .first()

  if (!row) {
    return null
  }

  if (
    !isLegacyReorderMetadata(row.variant_metadata) &&
    !isLegacyReorderMetadata(row.product_metadata)
  ) {
    return null
  }

  return {
    variant_id: row.variant_id,
    sku: row.sku,
    variant_title: row.variant_title,
    product_id: row.product_id,
    product_title: row.product_title,
  }
}

async function uniquePublishedVariantBySku(
  db: KnexLike,
  sku: string | null
): Promise<VariantTarget | "ambiguous" | null> {
  const normalizedSku = normalizeText(sku)
  if (!normalizedSku || isGenericTitle(normalizedSku)) {
    return null
  }

  const rows = await db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "p.title as product_title",
      "pv.metadata as variant_metadata",
      "p.metadata as product_metadata",
    ])
    .whereNull("pv.deleted_at")
    .whereNull("p.deleted_at")
    .where("p.status", ProductStatus.PUBLISHED)
    .whereRaw("lower(pv.sku) = lower(?)", [normalizedSku])

  const currentRows = rows.filter(
    (row: any) =>
      !isLegacyReorderMetadata(row.variant_metadata) &&
      !isLegacyReorderMetadata(row.product_metadata)
  )

  if (currentRows.length > 1) {
    return "ambiguous"
  }

  const row = currentRows[0]
  if (!row) {
    return null
  }

  return {
    variant_id: row.variant_id,
    sku: row.sku,
    variant_title: row.variant_title,
    product_id: row.product_id,
    product_title: row.product_title,
  }
}

async function mapCandidateToVariant(
  db: KnexLike,
  candidate: CandidateRow,
  variant: VariantTarget,
  input: {
    dryRun: boolean
    mappingSource: string
    sourceLabel: string
    metadata?: Record<string, unknown>
  }
) {
  return upsertLegacyItemMapping(db, {
    qbdItemListId: candidate.qbd_item_list_id,
    qbdName: normalizeText(candidate.title),
    sku: normalizeText(candidate.sku),
    medusaVariantId: variant.variant_id,
    confidence: 1,
    mappingSource: input.mappingSource,
    sourceLabel: input.sourceLabel,
    metadata: {
      legacy_reorder_only: input.mappingSource === "legacy_reorder_only_product",
      qbd_item_line_count: countNumber(candidate.line_count),
      ...(input.metadata || {}),
    },
    dryRun: input.dryRun,
  })
}

async function createLegacyReorderVariant(
  container: ExecArgs["container"],
  db: KnexLike,
  candidate: CandidateRow,
  qbdItem: QbdItemFact,
  price: { amount: number; source: string }
): Promise<VariantTarget> {
  const shippingProfileId = await defaultShippingProfileId(db)
  if (!shippingProfileId) {
    throw new Error("No shipping profile found for legacy reorder product")
  }

  const qbdItemListId = candidate.qbd_item_list_id
  const title = titleFromCandidate(candidate, qbdItem)
  const now = new Date().toISOString()
  const metadata = {
    legacy_reorder_only: true,
    legacy_hidden_from_storefront: true,
    legacy_source: "quickbooks_desktop",
    qbd_item_list_id: qbdItemListId,
    qbd_item_type: qbdItem.type,
    qbd_item_name: qbdItem.name,
    qbd_item_full_name: qbdItem.full_name,
    qbd_item_active: qbdItem.is_active,
    legacy_sku: candidate.sku,
    legacy_sample_description: candidate.sample_description,
    legacy_line_count: countNumber(candidate.line_count),
    legacy_order_count: countNumber(candidate.order_count),
    legacy_customer_count: countNumber(candidate.customer_count),
    legacy_latest_unit_price: positivePrice(candidate.latest_unit_price),
    legacy_average_unit_price: positivePrice(candidate.average_unit_price),
    legacy_reorder_price_source: price.source,
    imported_by: "import-legacy-reorder-only-products",
    imported_at: now,
  }

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title,
          subtitle: "Legacy reorder-only item",
          description:
            "Hidden item used to make historical QuickBooks purchases directly reorderable.",
          handle: legacyProductHandle(qbdItemListId),
          status: ProductStatus.DRAFT,
          shipping_profile_id: shippingProfileId,
          metadata,
          options: [
            {
              title: "Legacy Item",
              values: ["Standard"],
            },
          ],
          variants: [
            {
              title: "Standard",
              sku: legacyVariantSku(qbdItemListId),
              manage_inventory: false,
              allow_backorder: true,
              metadata,
              options: {
                "Legacy Item": "Standard",
              },
              prices: [
                {
                  amount: price.amount,
                  currency_code: "usd",
                },
              ],
            },
          ],
        },
      ],
    },
  })

  const product = result?.[0]
  const variant = product?.variants?.[0]
  if (!product?.id || !variant?.id) {
    throw new Error(`Failed to create legacy reorder variant for ${qbdItemListId}`)
  }

  return {
    variant_id: variant.id,
    sku: variant.sku ?? null,
    variant_title: variant.title ?? null,
    product_id: product.id,
    product_title: product.title ?? null,
  }
}

function candidateSummary(candidate: CandidateRow, extra: Record<string, unknown> = {}) {
  return {
    qbd_item_list_id: candidate.qbd_item_list_id,
    sku: candidate.sku,
    title: candidate.title,
    sample_description: candidate.sample_description,
    line_count: countNumber(candidate.line_count),
    order_count: countNumber(candidate.order_count),
    customer_count: countNumber(candidate.customer_count),
    latest_unit_price: positivePrice(candidate.latest_unit_price),
    average_unit_price: positivePrice(candidate.average_unit_price),
    last_ordered_at: candidate.last_ordered_at,
    ...extra,
  }
}

export default async function importLegacyReorderOnlyProducts({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const includeInactive = getBooleanArg(args, ["include-inactive"], false)
  const limit = Math.min(Math.max(getNumberArg(args, ["limit"], 50), 1), 500)
  const offset = Math.max(getNumberArg(args, ["offset"], 0), 0)
  const minLines = Math.max(getNumberArg(args, ["min-lines"], 2), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 10), 0)
  const sourceLabel = "import-legacy-reorder-only-products"
  const dryRun = !apply

  const stats: Record<string, any> = {
    mode: apply ? "apply" : "dry-run",
    limit,
    offset,
    minLines,
    seen: 0,
    skippedGeneric: 0,
    skippedExistingItemMap: 0,
    skippedAmbiguousCurrentSku: 0,
    mappedExistingLegacyReorderVariant: 0,
    mappedCurrentSkuVariant: 0,
    qbdLookups: 0,
    skippedQbdUnavailable: 0,
    skippedQbdMissing: 0,
    skippedInactiveQbdItem: 0,
    skippedUnsupportedQbdType: 0,
    skippedNonMerchandiseItem: 0,
    skippedNoPrice: 0,
    wouldCreateProducts: 0,
    productsCreated: 0,
    lineRowsWouldBackfill: 0,
    lineRowsBackfilled: 0,
    failed: 0,
    samples: {},
  }

  const candidates = await listCandidates(db, { limit, offset, minLines })
  stats.seen = candidates.length

  for (const candidate of candidates) {
    const qbdItemListId = normalizeText(candidate.qbd_item_list_id)
    if (!qbdItemListId) {
      continue
    }

    if (
      countNumber(candidate.generic_line_count) > 0 ||
      isGenericTitle(candidate.sku) ||
      isGenericTitle(candidate.title)
    ) {
      stats.skippedGeneric += 1
      sample(stats.samples, "skippedGeneric", candidateSummary(candidate), sampleLimit)
      continue
    }

    try {
      const itemMap = await existingItemMap(db, qbdItemListId)
      if (itemMap) {
        stats.skippedExistingItemMap += 1
        sample(
          stats.samples,
          "skippedExistingItemMap",
          candidateSummary(candidate, {
            medusa_variant_id: itemMap.medusa_variant_id,
          }),
          sampleLimit
        )
        continue
      }

      const existingLegacyVariant = await existingLegacyReorderVariant(
        db,
        qbdItemListId
      )
      if (existingLegacyVariant) {
        const result = await mapCandidateToVariant(db, candidate, existingLegacyVariant, {
          dryRun,
          mappingSource: "legacy_reorder_only_product",
          sourceLabel,
          metadata: { reused_existing_legacy_reorder_variant: true },
        })

        stats.mappedExistingLegacyReorderVariant += 1
        stats[dryRun ? "lineRowsWouldBackfill" : "lineRowsBackfilled"] +=
          result.lineRowsBackfilled
        sample(
          stats.samples,
          "mappedExistingLegacyReorderVariant",
          candidateSummary(candidate, {
            medusa_variant_id: existingLegacyVariant.variant_id,
            line_rows: result.lineRowsBackfilled,
          }),
          sampleLimit
        )
        continue
      }

      const currentVariant = await uniquePublishedVariantBySku(db, candidate.sku)
      if (currentVariant === "ambiguous") {
        stats.skippedAmbiguousCurrentSku += 1
        sample(
          stats.samples,
          "skippedAmbiguousCurrentSku",
          candidateSummary(candidate),
          sampleLimit
        )
        continue
      }

      if (currentVariant) {
        const result = await mapCandidateToVariant(db, candidate, currentVariant, {
          dryRun,
          mappingSource: "legacy_exact_sku_current_product",
          sourceLabel,
          metadata: { mapped_to_existing_current_product: true },
        })

        stats.mappedCurrentSkuVariant += 1
        stats[dryRun ? "lineRowsWouldBackfill" : "lineRowsBackfilled"] +=
          result.lineRowsBackfilled
        sample(
          stats.samples,
          "mappedCurrentSkuVariant",
          candidateSummary(candidate, {
            medusa_variant_id: currentVariant.variant_id,
            medusa_sku: currentVariant.sku,
            medusa_product_title: currentVariant.product_title,
            line_rows: result.lineRowsBackfilled,
          }),
          sampleLimit
        )
        continue
      }

      stats.qbdLookups += 1
      const qbdLookup = await retrieveQbdItemFact(qbdItemListId, { logger })
      if (!qbdLookup.available) {
        stats.skippedQbdUnavailable += 1
        sample(
          stats.samples,
          "skippedQbdUnavailable",
          candidateSummary(candidate, { reason: qbdLookup.reason }),
          sampleLimit
        )
        continue
      }

      if (!qbdLookup.item) {
        stats.skippedQbdMissing += 1
        sample(
          stats.samples,
          "skippedQbdMissing",
          candidateSummary(candidate),
          sampleLimit
        )
        continue
      }

      if (qbdLookup.item.is_active === false && !includeInactive) {
        stats.skippedInactiveQbdItem += 1
        sample(
          stats.samples,
          "skippedInactiveQbdItem",
          candidateSummary(candidate, {
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
          }),
          sampleLimit
        )
        continue
      }

      if (!SUPPORTED_QBD_PRODUCT_TYPES.has(qbdLookup.item.type)) {
        stats.skippedUnsupportedQbdType += 1
        sample(
          stats.samples,
          "skippedUnsupportedQbdType",
          candidateSummary(candidate, {
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
          }),
          sampleLimit
        )
        continue
      }

      if (
        isGenericTitle(qbdLookup.item.name) ||
        isGenericTitle(qbdLookup.item.full_name)
      ) {
        stats.skippedGeneric += 1
        sample(
          stats.samples,
          "skippedGeneric",
          candidateSummary(candidate, {
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
          }),
          sampleLimit
        )
        continue
      }

      if (isNonMerchandiseReorderItem(candidate, qbdLookup.item)) {
        stats.skippedNonMerchandiseItem += 1
        sample(
          stats.samples,
          "skippedNonMerchandiseItem",
          candidateSummary(candidate, {
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
          }),
          sampleLimit
        )
        continue
      }

      const price = selectedPrice(candidate, qbdLookup.item)
      if (!price) {
        stats.skippedNoPrice += 1
        sample(
          stats.samples,
          "skippedNoPrice",
          candidateSummary(candidate, {
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
          }),
          sampleLimit
        )
        continue
      }

      if (dryRun) {
        stats.wouldCreateProducts += 1
        stats.lineRowsWouldBackfill += countNumber(candidate.line_count)
        sample(
          stats.samples,
          "wouldCreateProducts",
          candidateSummary(candidate, {
            title: titleFromCandidate(candidate, qbdLookup.item),
            qbd_item_type: qbdLookup.item.type,
            qbd_item_name: itemName(candidate, qbdLookup.item),
            price: price.amount,
            price_source: price.source,
            product_status: ProductStatus.DRAFT,
            variant_sku: legacyVariantSku(qbdItemListId),
          }),
          sampleLimit
        )
        continue
      }

      const createdVariant = await createLegacyReorderVariant(
        container,
        db,
        candidate,
        qbdLookup.item,
        price
      )
      const result = await mapCandidateToVariant(db, candidate, createdVariant, {
        dryRun: false,
        mappingSource: "legacy_reorder_only_product",
        sourceLabel,
        metadata: {
          created_legacy_reorder_product: true,
          price: price.amount,
          price_source: price.source,
          qbd_item_type: qbdLookup.item.type,
        },
      })

      stats.productsCreated += 1
      stats.lineRowsBackfilled += result.lineRowsBackfilled
      sample(
        stats.samples,
        "productsCreated",
        candidateSummary(candidate, {
          medusa_product_id: createdVariant.product_id,
          medusa_variant_id: createdVariant.variant_id,
          variant_sku: createdVariant.sku,
          price: price.amount,
          price_source: price.source,
          line_rows: result.lineRowsBackfilled,
        }),
        sampleLimit
      )
    } catch (error) {
      stats.failed += 1
      sample(
        stats.samples,
        "failed",
        candidateSummary(candidate, {
          error: error instanceof Error ? error.message : String(error),
        }),
        sampleLimit
      )
      logger.error(
        `[legacy-reorder-only-products] failed qbd_item_list_id=${qbdItemListId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  logger.info(
    `[legacy-reorder-only-products] ${apply ? "applied" : "dry-run"} ${JSON.stringify(
      stats
    )}`
  )
}
