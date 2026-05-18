import { writeFile } from "node:fs/promises"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  retrieveQbdItemFact,
  type QbdItemFact,
} from "../lib/legacy-qbd-item-facts"
import {
  getBooleanArg,
  getNumberArg,
  getStringArg,
  parseArgs,
  toNumber,
  toText,
} from "./lib/legacy-import-utils"

type CandidateRow = {
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  sample_description: string | null
  line_count: string | number
  order_count: string | number
  customer_count: string | number
  latest_unit_price: string | number | null
  average_unit_price: string | number | null
  last_ordered_at: string | Date | null
  last_order_ref: string | null
  generic_line_count: string | number
  description_count: string | number
  existing_mapped_item_map_count: string | number
}

type Bucket = {
  groups: number
  lines: number
  orderCount: number
  customerCount: number
  samples: Array<Record<string, unknown>>
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

function genericTitleSql(alias = "lol") {
  const normalizedTitle = `btrim(regexp_replace(lower(coalesce(${alias}.title, '')), '[^a-z0-9]+', ' ', 'g'))`
  const normalizedSku = `btrim(regexp_replace(lower(coalesce(${alias}.sku, '')), '[^a-z0-9]+', ' ', 'g'))`
  const values = GENERIC_TITLE_VALUES.map((value) => `'${value}'`).join(", ")

  return `(${normalizedTitle} in (${values}) or ${normalizedSku} in (${values}))`
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
    /\btzedakah\b/.test(blob) ||
    /\bbad\s+(check|debt)\b/.test(blob) ||
    /\breturned\s+check\b/.test(blob) ||
    /\bcc\s+dispute\b/.test(blob) ||
    /\bchargeback\b/.test(blob) ||
    /\brebill\b/.test(blob) ||
    /\bstaff\s+allowance\b/.test(blob) ||
    /\bsales\s+tax\b/.test(blob) ||
    /\bfedex(ground|overnight)\b/.test(blob) ||
    /\brepack\s+(charge|surcharge)\b/.test(blob) ||
    /\bbulk\s+case\s+repack\b/.test(blob) ||
    /\badmin\s+fee\b/.test(blob) ||
    /\bcommis?sion\b/.test(blob) ||
    /\bstamp\s+charge\b/.test(blob) ||
    /\bprices\s+are\s+extremely\s+volatile\b/.test(blob)
  )
}

function positivePrice(value: unknown): number | null {
  const normalized =
    typeof value === "string" ? value.replace(/[$,]/g, "").trim() : value
  const price = toNumber(normalized)

  return Number.isFinite(price) && price > 0
    ? Math.round(price * 100) / 100
    : null
}

function compactCandidate(
  candidate: CandidateRow,
  extra: Record<string, unknown> = {}
) {
  return {
    qbd_item_list_id: candidate.qbd_item_list_id,
    sku: candidate.sku,
    title: candidate.title,
    sample_description: candidate.sample_description,
    line_count: toNumber(candidate.line_count),
    order_count: toNumber(candidate.order_count),
    customer_count: toNumber(candidate.customer_count),
    latest_unit_price: positivePrice(candidate.latest_unit_price),
    average_unit_price: positivePrice(candidate.average_unit_price),
    last_ordered_at: candidate.last_ordered_at,
    ...extra,
  }
}

function emptyBucket(): Bucket {
  return {
    groups: 0,
    lines: 0,
    orderCount: 0,
    customerCount: 0,
    samples: [],
  }
}

function addBucket(
  buckets: Record<string, Bucket>,
  key: string,
  candidate: CandidateRow,
  sampleLimit: number,
  extra: Record<string, unknown> = {}
) {
  const bucket = buckets[key] ?? emptyBucket()
  bucket.groups += 1
  bucket.lines += toNumber(candidate.line_count)
  bucket.orderCount += toNumber(candidate.order_count)
  bucket.customerCount += toNumber(candidate.customer_count)
  if (bucket.samples.length < sampleLimit) {
    bucket.samples.push(compactCandidate(candidate, extra))
  }
  buckets[key] = bucket
}

async function listCandidates(
  db: any,
  input: { limit: number; offset: number; minLines: number }
): Promise<CandidateRow[]> {
  const genericSql = genericTitleSql("lol")

  return db("legacy_order_line as lol")
    .join("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .leftJoin("legacy_item_map as lim", function joinItemMap(this: any) {
      this.on("lim.qbd_item_list_id", "=", "lol.qbd_item_list_id")
        .andOnNull("lim.deleted_at")
        .andOnNotNull("lim.medusa_variant_id")
    })
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
      db.raw("count(distinct lim.id) as existing_mapped_item_map_count"),
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
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

async function mapLimit<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let cursor = 0
  const workers = Array.from({
    length: Math.min(Math.max(concurrency, 1), items.length),
  }).map(async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  })

  await Promise.all(workers)
}

async function classifyCandidate(
  candidate: CandidateRow,
  options: {
    includeQbdItems: boolean
    logger: { warn?: (message: string) => void }
  }
) {
  if (!toText(candidate.qbd_item_list_id)) {
    return { bucket: "missing_qbd_item_list_id" }
  }

  if (
    toNumber(candidate.generic_line_count) > 0 ||
    isGenericTitle(candidate.sku) ||
    isGenericTitle(candidate.title)
  ) {
    return { bucket: "generic_bucket" }
  }

  if (toNumber(candidate.existing_mapped_item_map_count) > 0) {
    return { bucket: "stale_existing_item_map" }
  }

  if (!options.includeQbdItems) {
    return { bucket: "needs_qbd_fact_lookup" }
  }

  const qbdLookup = await retrieveQbdItemFact(candidate.qbd_item_list_id, {
    logger: options.logger,
  })

  if (!qbdLookup.available) {
    return {
      bucket: "qbd_lookup_unavailable",
      extra: { qbd_lookup_reason: qbdLookup.reason },
    }
  }

  if (!qbdLookup.item) {
    return { bucket: "qbd_item_missing" }
  }

  const qbdItem = qbdLookup.item
  const qbdExtra = {
    qbd_item_type: qbdItem.type,
    qbd_item_name: qbdItem.name,
    qbd_item_full_name: qbdItem.full_name,
    qbd_item_active: qbdItem.is_active,
    qbd_sales_price: positivePrice(qbdItem.sales_price),
  }

  if (qbdItem.is_active === false) {
    return {
      bucket: "inactive_qbd_product_like_item",
      extra: qbdExtra,
    }
  }

  if (isNonMerchandiseReorderItem(candidate, qbdItem)) {
    return {
      bucket: "non_merchandise_qbd_item",
      extra: qbdExtra,
    }
  }

  if (!SUPPORTED_QBD_PRODUCT_TYPES.has(qbdItem.type)) {
    return {
      bucket: "unsupported_qbd_type",
      extra: qbdExtra,
    }
  }

  if (isGenericTitle(qbdItem.name) || isGenericTitle(qbdItem.full_name)) {
    return {
      bucket: "generic_bucket",
      extra: qbdExtra,
    }
  }

  return {
    bucket: "active_qbd_product_like_item",
    extra: qbdExtra,
  }
}

export default async function auditLegacyUnmappedProductTail({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const limit = Math.min(Math.max(getNumberArg(args, ["limit"], 100), 1), 2000)
  const offset = Math.max(getNumberArg(args, ["offset"], 0), 0)
  const minLines = Math.max(getNumberArg(args, ["min-lines"], 1), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 5), 0)
  const includeQbdItems = getBooleanArg(
    args,
    ["include-qbd-items", "include-qbd-item"],
    false
  )
  const concurrency = Math.min(
    Math.max(getNumberArg(args, ["concurrency"], 2), 1),
    8
  )
  const output = getStringArg(args, ["output", "file"])

  const candidates = await listCandidates(db, { limit, offset, minLines })
  const buckets: Record<string, Bucket> = {}

  await mapLimit(candidates, includeQbdItems ? concurrency : 1, async (candidate) => {
    const result = await classifyCandidate(candidate, {
      includeQbdItems,
      logger,
    })
    addBucket(
      buckets,
      result.bucket,
      candidate,
      sampleLimit,
      result.extra ?? {}
    )
  })

  const report = {
    limit,
    offset,
    minLines,
    includeQbdItems,
    concurrency: includeQbdItems ? concurrency : null,
    groupsSeen: candidates.length,
    linesSeen: candidates.reduce(
      (sum, candidate) => sum + toNumber(candidate.line_count),
      0
    ),
    buckets,
  }

  if (output) {
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  }

  logger.info(`[legacy-unmapped-product-tail-audit] ${JSON.stringify(report)}`)
}
