import crypto from "node:crypto"
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createProductVariantsWorkflow,
  createProductsWorkflow,
} from "@medusajs/medusa/core-flows"
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
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  description: string | null
  line_count: string | number
  order_count: string | number
  customer_count: string | number
  total_quantity: string | number
  latest_unit_price: string | number | null
  average_unit_price: string | number | null
  last_ordered_at: string | Date | null
  last_order_ref: string | null
}

type VariantTarget = {
  variant_id: string
  sku: string | null
  variant_title: string | null
  product_id: string | null
  product_title: string | null
}

type ScopedProductTarget = {
  product_id: string
  product_title: string | null
}

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

function selectedPrice(candidate: CandidateRow) {
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

function candidateIdentity(candidate: CandidateRow) {
  return [
    candidate.qbd_item_list_id,
    candidate.sku,
    candidate.title,
    candidate.description,
  ]
    .map((value) => normalizeText(value) || "")
    .join("|")
}

function legacyProductHandle(candidate: CandidateRow) {
  const identity = candidateIdentity(candidate)
  return `legacy-scoped-reorder-${slugPart(
    normalizeText(candidate.description) || identity,
    55
  )}-${stableHash(identity)}`
}

function legacyVariantSku(candidate: CandidateRow) {
  const base = [
    normalizeText(candidate.sku) || normalizeText(candidate.title) || "ITEM",
    stableHash(candidateIdentity(candidate)).toUpperCase(),
  ]
    .join("-")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "")

  return `LSCOPE-${base || stableHash(candidateIdentity(candidate)).toUpperCase()}`
}

function cleanDisplayTitle(value: unknown) {
  const text =
    normalizeText(value)
      ?.replace(/^misc(?:ellaneous|ellanous)?\.?\s+item\s*,?\s*/i, "")
      .replace(/\s+/g, " ")
      .trim() || "Legacy custom reorder item"

  return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text
}

function scopedLegacyMetadata(
  candidate: CandidateRow,
  price: { amount: number; source: string },
  now = new Date().toISOString()
) {
  const identity = candidateIdentity(candidate)

  return {
    legacy_reorder_only: true,
    legacy_hidden_from_storefront: true,
    legacy_source: "quickbooks_desktop",
    legacy_scope: "description_match_rule",
    qbd_item_list_id: candidate.qbd_item_list_id,
    legacy_sku: candidate.sku,
    legacy_title: candidate.title,
    legacy_description_fingerprint: candidate.description,
    legacy_line_count: countNumber(candidate.line_count),
    legacy_order_count: countNumber(candidate.order_count),
    legacy_customer_count: countNumber(candidate.customer_count),
    legacy_latest_unit_price: positivePrice(candidate.latest_unit_price),
    legacy_average_unit_price: positivePrice(candidate.average_unit_price),
    legacy_reorder_price_source: price.source,
    imported_by: "import-legacy-scoped-reorder-only-products",
    imported_at: now,
    identity_hash: stableHash(identity),
  }
}

function isClearlyNonReorderableDescription(value: unknown) {
  const text = normalizeSearchText(value)

  if (!text) {
    return true
  }

  return (
    /\b(custom cutting fee|cutting fee|additional trimming|trimming charge)\b/.test(text) ||
    /\b(received .* instead|did not receive|wrong product|did not want)\b/.test(text) ||
    /\b(from home depot|plastic grocery bags|shopping bags|regular box|plastic containers|insulated container|baking pans|brochures|k360 box|soup containers)\b/.test(text) ||
    /\b(expired|for don|for jodie|no charge|helping|from june|costel order|yoel habif|jeffrey sunday|out of date)\b/.test(text) ||
    /\b(peter to bring|peter to try|peter to pick up|pick up at kroger)\b/.test(text) ||
    /\b(this is for .* order)\b/.test(text) ||
    /\border\s*#?\s*\d+\b/.test(text) ||
    /\b(advance medical|agreed charge|balance on acct|customer delivery|deliver mike morris|frenching charge|ice charge|ice purchased for return trip|item tip|pmt on acct|price adjustment|re pack charge|tip thank|transportation|uber)\b/.test(text) ||
    /\bfrom .* account\b/.test(text)
  )
}

function looksLikeFoodOrButcherProduct(value: unknown) {
  const text = normalizeSearchText(value)
  const rawText = String(value ?? "").toLowerCase()

  return (
    /\b[a-z]?\d{5,6}\s*:/.test(rawText) ||
    /\brm-as-\d+\b/.test(rawText) ||
    /\b(agristar|almond|apple|babaganush|baguette|baguettes|basil|batampte|beef|biscotti|bison|boeries|bologna|bone|bones|brisket|briskets|broth|bun|buns|burger|burgers|butter|butternut|cabbage|cake|carrot|carrots|casings|challah|challahs|cheese|chicken|chilli|chips|chocolate|choc|chix|coca|coke|cokes|cola|cookie|cookies|corn|corned|cranberry|cream|cube|cubes|curry|cutlet|cutlets|deckel|deli|dressing|duck|eggplant|extract|farfel|fillet|fish|frank|franks|gefen|gefilte|gefiltle|glick|glicks|grape|haolam|heart|hearts|herring|horseradish|hotdog|hotdogs|juice|ketchup|knockwurst|kugel|lamb|lettuce|lieber|liebers|liver|manischewitz|margarine|matz|matza|matzah|matzo|meal|mielie|milk|miami|mozz|mozzarella|mushroom|neck|necks|nugget|nuggets|oil|olive|olives|onion soup|osso|palm|panko|pap|pastrami|passover|patty|patties|pesach|pie|pita|pizza|platter|potato|potatoes|rib|ribeye|riblet|riblets|ribs|roast|roll|rolls|salad|salami|salmon|sausage|schnitzel|schwarma|shawarma|shank|shanks|shepard|shoulder|sliders|soda|souffle|soup|spray|spice|squares|starch|steak|steaks|stew|stuffed|sugar|telma|temptee|tender|tenders|tilapia|tomato|trout|tuna|turkey|turkeys|tukey|veal|vegan|vegetable|vita|whitefish|wing|wings|yehuda|knuckle|knuckles)\b/.test(text)
  )
}

function isScopedReorderCandidate(candidate: CandidateRow) {
  return (
    Boolean(normalizeText(candidate.qbd_item_list_id)) &&
    Boolean(normalizeText(candidate.description)) &&
    !isClearlyNonReorderableDescription(candidate.description) &&
    looksLikeFoodOrButcherProduct(candidate.description)
  )
}

function sample(stats: Record<string, unknown[]>, key: string, value: unknown, limit: number) {
  const bucket = stats[key] ?? []
  if (bucket.length < limit) {
    bucket.push(value)
  }
  stats[key] = bucket
}

function candidateSummary(candidate: CandidateRow, extra: Record<string, unknown> = {}) {
  return {
    qbd_item_list_id: candidate.qbd_item_list_id,
    sku: candidate.sku,
    title: candidate.title,
    description: candidate.description,
    line_count: countNumber(candidate.line_count),
    order_count: countNumber(candidate.order_count),
    customer_count: countNumber(candidate.customer_count),
    latest_unit_price: positivePrice(candidate.latest_unit_price),
    average_unit_price: positivePrice(candidate.average_unit_price),
    last_ordered_at: candidate.last_ordered_at,
    ...extra,
  }
}

async function listCandidates(
  db: KnexLike,
  input: { limit: number; offset: number; minLines: number }
): Promise<CandidateRow[]> {
  return db("legacy_order_line as lol")
    .join("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .select([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      db.raw("coalesce(nullif(lol.description, ''), '') as description"),
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
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
    .andWhere((builder: any) => {
      builder
        .whereRaw("coalesce(lol.metadata->>'line_kind', 'product') = 'product'")
        .orWhereNull("lol.metadata")
    })
    .groupBy(["lol.qbd_item_list_id", "lol.sku", "lol.title", "lol.description"])
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

async function createScopedReorderVariant(
  container: ExecArgs["container"],
  db: KnexLike,
  candidate: CandidateRow,
  price: { amount: number; source: string }
): Promise<VariantTarget> {
  const existingVariant = await findExistingScopedVariant(db, candidate)
  if (existingVariant) {
    return existingVariant
  }

  const existingProduct = await findExistingScopedProduct(db, candidate)
  if (existingProduct) {
    return createVariantForExistingScopedProduct(
      container,
      candidate,
      existingProduct,
      price
    )
  }

  const shippingProfileId = await defaultShippingProfileId(db)
  if (!shippingProfileId) {
    throw new Error("No shipping profile found for scoped legacy reorder product")
  }

  const title = cleanDisplayTitle(candidate.description)
  const now = new Date().toISOString()
  const identity = candidateIdentity(candidate)
  const metadata = scopedLegacyMetadata(candidate, price, now)

  const { result } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title,
          subtitle: "Legacy custom reorder-only item",
          description:
            "Hidden item used to make a scoped historical QuickBooks purchase directly reorderable.",
          handle: legacyProductHandle(candidate),
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
              sku: legacyVariantSku(candidate),
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
    throw new Error(`Failed to create scoped legacy reorder variant for ${identity}`)
  }

  return {
    variant_id: variant.id,
    sku: variant.sku ?? null,
    variant_title: variant.title ?? null,
    product_id: product.id,
    product_title: product.title ?? null,
  }
}

async function findExistingScopedVariant(
  db: KnexLike,
  candidate: CandidateRow
): Promise<VariantTarget | null> {
  const variant = await db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku",
      "pv.title as variant_title",
      "p.id as product_id",
      "p.title as product_title",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder
        .where("pv.sku", legacyVariantSku(candidate))
        .orWhereRaw("pv.metadata->>? = ?", [
          "legacy_description_fingerprint",
          normalizeText(candidate.description),
        ])
    })
    .first()

  if (!variant?.variant_id) {
    return null
  }

  return {
    variant_id: variant.variant_id,
    sku: variant.sku ?? null,
    variant_title: variant.variant_title ?? null,
    product_id: variant.product_id ?? null,
    product_title: variant.product_title ?? null,
  }
}

async function findExistingScopedProduct(
  db: KnexLike,
  candidate: CandidateRow
): Promise<ScopedProductTarget | null> {
  const product = await db("product")
    .select(["id", "title"])
    .whereNull("deleted_at")
    .where((builder: any) => {
      builder
        .where("handle", legacyProductHandle(candidate))
        .orWhereRaw("metadata->>? = ?", [
          "legacy_description_fingerprint",
          normalizeText(candidate.description),
        ])
    })
    .first()

  if (!product?.id) {
    return null
  }

  return {
    product_id: product.id,
    product_title: product.title ?? null,
  }
}

async function createVariantForExistingScopedProduct(
  container: ExecArgs["container"],
  candidate: CandidateRow,
  product: ScopedProductTarget,
  price: { amount: number; source: string }
): Promise<VariantTarget> {
  const metadata = scopedLegacyMetadata(candidate, price)
  const { result } = await createProductVariantsWorkflow(container).run({
    input: {
      product_variants: [
        {
          product_id: product.product_id,
          title: "Standard",
          sku: legacyVariantSku(candidate),
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
  })

  const variant = result?.[0]
  if (!variant?.id) {
    throw new Error(
      `Failed to repair scoped legacy reorder variant for ${candidateIdentity(candidate)}`
    )
  }

  return {
    variant_id: variant.id,
    sku: variant.sku ?? null,
    variant_title: variant.title ?? null,
    product_id: product.product_id,
    product_title: product.product_title,
  }
}

async function mapCandidateToVariant(
  db: KnexLike,
  candidate: CandidateRow,
  variant: VariantTarget,
  input: { dryRun: boolean; sourceLabel: string; price: { amount: number; source: string } }
) {
  return upsertLegacyItemMapping(db, {
    qbdItemListId: candidate.qbd_item_list_id,
    qbdName: normalizeText(candidate.title),
    sku: normalizeText(candidate.sku),
    descriptionContains: normalizeText(candidate.description),
    medusaVariantId: variant.variant_id,
    confidence: 0.95,
    mappingSource: "legacy_scoped_reorder_only_product",
    priority: 25,
    sourceLabel: input.sourceLabel,
    metadata: {
      legacy_reorder_only: true,
      scoped_description_rule: true,
      qbd_item_line_count: countNumber(candidate.line_count),
      price: input.price.amount,
      price_source: input.price.source,
    },
    dryRun: input.dryRun,
  })
}

async function countScopedBackfillRows(db: KnexLike, candidate: CandidateRow) {
  const [{ count }] = await db("legacy_order_line")
    .whereNull("deleted_at")
    .where("qbd_item_list_id", candidate.qbd_item_list_id)
    .andWhereRaw("position(lower(?) in lower(coalesce(description, ''))) > 0", [
      normalizeText(candidate.description),
    ])
    .andWhere((builder: any) => {
      builder
        .whereIn("mapping_status", ["mapped", "unmapped", "staff_assisted"])
        .orWhereRaw("metadata->>? = ?", ["line_kind", "product"])
    })
    .count({ count: "*" })

  return Number(count) || 0
}

export default async function importLegacyScopedReorderOnlyProducts({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const limit = Math.min(Math.max(getNumberArg(args, ["limit"], 100), 1), 1000)
  const offset = Math.max(getNumberArg(args, ["offset"], 0), 0)
  const minLines = Math.max(getNumberArg(args, ["min-lines"], 1), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 10), 0)
  const sourceLabel = "import-legacy-scoped-reorder-only-products"
  const dryRun = !apply

  const stats: Record<string, any> = {
    mode: apply ? "apply" : "dry-run",
    limit,
    offset,
    minLines,
    seen: 0,
    skippedNotScopedProduct: 0,
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
    if (!isScopedReorderCandidate(candidate)) {
      stats.skippedNotScopedProduct += 1
      sample(
        stats.samples,
        "skippedNotScopedProduct",
        candidateSummary(candidate),
        sampleLimit
      )
      continue
    }

    const price = selectedPrice(candidate)
    if (!price) {
      stats.skippedNoPrice += 1
      sample(stats.samples, "skippedNoPrice", candidateSummary(candidate), sampleLimit)
      continue
    }

    try {
      if (dryRun) {
        const lineRows = await countScopedBackfillRows(db, candidate)

        stats.wouldCreateProducts += 1
        stats.lineRowsWouldBackfill += lineRows
        sample(
          stats.samples,
          "wouldCreateProducts",
          candidateSummary(candidate, {
            title: cleanDisplayTitle(candidate.description),
            price: price.amount,
            price_source: price.source,
            product_status: ProductStatus.DRAFT,
            variant_sku: legacyVariantSku(candidate),
            line_rows: lineRows,
          }),
          sampleLimit
        )
        continue
      }

      const createdVariant = await createScopedReorderVariant(
        container,
        db,
        candidate,
        price
      )
      const result = await mapCandidateToVariant(db, candidate, createdVariant, {
        dryRun: false,
        sourceLabel,
        price,
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
        `[legacy-scoped-reorder-only-products] failed qbd_item_list_id=${
          candidate.qbd_item_list_id
        }: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  logger.info(
    `[legacy-scoped-reorder-only-products] ${apply ? "applied" : "dry-run"} ${JSON.stringify(
      stats
    )}`
  )
}
