import { isGenericLegacyItemTitle } from "./legacy-line-kind"

type KnexLike = any

export type LegacyItemMappingCandidateQuery = {
  q?: string | null
  limit?: number
  offset?: number
  minLines?: number
}

export type LegacyItemMappingCandidateScope = {
  qbdItemListId?: string | null
  sku?: string | null
  title?: string | null
  descriptionGroup?: string | null
}

const GENERIC_TITLE_VALUES = [
  "misc item",
  "miscellaneous item",
  "misc services",
  "misc service",
]

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof (value as any).toNumber === "function") {
    return Number((value as any).toNumber())
  }

  return 0
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

export function normalizeLegacyDescriptionGroup(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function nullableScopeCondition(query: any, column: string, value: string | null) {
  if (value) {
    query.where(column, value)
  } else {
    query.whereNull(column)
  }
}

function genericTitleSql(alias = "lol") {
  const normalizedTitle = `btrim(regexp_replace(lower(coalesce(${alias}.title, '')), '[^a-z0-9]+', ' ', 'g'))`
  const normalizedSku = `btrim(regexp_replace(lower(coalesce(${alias}.sku, '')), '[^a-z0-9]+', ' ', 'g'))`
  const values = GENERIC_TITLE_VALUES.map((value) => `'${value}'`).join(", ")

  return {
    sql: `(${normalizedTitle} in (${values}) or ${normalizedSku} in (${values}))`,
    bindings: [],
  }
}

function descriptionGroupSql(alias = "lol") {
  const generic = genericTitleSql(alias)

  return {
    sql: `case when ${generic.sql} then btrim(regexp_replace(lower(coalesce(${alias}.description, '')), '[^a-z0-9]+', ' ', 'g')) else '' end`,
    bindings: generic.bindings,
  }
}

function applyVisibleUnmappedProductFilters(query: any) {
  query
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")
    .where("lol.mapping_status", "unmapped")
    .andWhere((builder: any) => {
      builder
        .whereRaw("coalesce(lol.metadata->>'line_kind', 'product') = 'product'")
        .orWhereNull("lol.metadata")
    })
}

function applySearch(query: any, q?: string | null) {
  const search = normalizeText(q)
  if (!search) {
    return
  }

  const like = `%${search.toLowerCase()}%`
  query.andWhere((builder: any) => {
    builder
      .whereRaw("lower(coalesce(lol.qbd_item_list_id, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lol.sku, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lol.title, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lol.description, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lo.ref_number, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lo.qbd_txn_id, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lo.customer_name, '')) like ?", [like])
      .orWhereRaw("lower(coalesce(lo.email_lower, '')) like ?", [like])
  })
}

function buildBaseLineQuery(db: KnexLike, q?: string | null) {
  const query = db("legacy_order_line as lol").join(
    "legacy_order as lo",
    "lo.id",
    "lol.legacy_order_id"
  )

  applyVisibleUnmappedProductFilters(query)
  applySearch(query, q)

  return query
}

export function applyCandidateScope(
  query: any,
  scope: LegacyItemMappingCandidateScope
) {
  const qbdItemListId = normalizeText(scope.qbdItemListId)
  const sku = normalizeText(scope.sku)
  const title = normalizeText(scope.title)
  const descriptionGroup = normalizeLegacyDescriptionGroup(scope.descriptionGroup)
  const descriptionGroupExpression = descriptionGroupSql("lol")

  nullableScopeCondition(query, "lol.qbd_item_list_id", qbdItemListId)
  nullableScopeCondition(query, "lol.sku", sku)
  nullableScopeCondition(query, "lol.title", title)

  if (descriptionGroup) {
    query.andWhereRaw(`${descriptionGroupExpression.sql} = ?`, [
      ...descriptionGroupExpression.bindings,
      descriptionGroup,
    ])
  } else {
    query.andWhereRaw(`${descriptionGroupExpression.sql} = ''`, [
      ...descriptionGroupExpression.bindings,
    ])
  }
}

function candidateKey(row: any) {
  return Buffer.from(
    JSON.stringify([
      row.qbd_item_list_id ?? null,
      row.sku ?? null,
      row.title ?? null,
      row.description_group ?? "",
    ])
  ).toString("base64url")
}

function requiresDescriptionMatcher(row: any) {
  return Boolean(
    row.description_group ||
      isGenericLegacyItemTitle(row.title) ||
      isGenericLegacyItemTitle(row.sku)
  )
}

function serializeCandidate(row: any, topDescriptions: any[]) {
  const requiresMatcher = requiresDescriptionMatcher(row)
  const sampleDescription =
    normalizeText(row.sample_description) ||
    normalizeText(topDescriptions[0]?.description) ||
    null

  return {
    key: candidateKey(row),
    qbd_item_list_id: row.qbd_item_list_id ?? null,
    sku: row.sku ?? null,
    title: row.title ?? null,
    description_group: normalizeText(row.description_group),
    sample_description: sampleDescription,
    top_descriptions: topDescriptions.map((description) => ({
      description: description.description || "Blank description",
      line_count: asNumber(description.line_count),
      order_count: asNumber(description.order_count),
      last_ordered_at: description.last_ordered_at
        ? new Date(description.last_ordered_at).toISOString()
        : null,
    })),
    line_count: asNumber(row.line_count),
    order_count: asNumber(row.order_count),
    customer_count: asNumber(row.customer_count),
    total_quantity: asNumber(row.total_quantity),
    last_ordered_at: row.last_ordered_at
      ? new Date(row.last_ordered_at).toISOString()
      : null,
    last_order_ref: row.last_order_ref ?? null,
    last_customer_name: row.last_customer_name ?? null,
    description_count: asNumber(row.description_count),
    requires_description_matcher: requiresMatcher,
    suggested_description_contains: requiresMatcher ? sampleDescription : null,
  }
}

export async function getLegacyItemMappingCandidate(
  db: KnexLike,
  scope: LegacyItemMappingCandidateScope
) {
  const query = buildBaseLineQuery(db)
    .select([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      db.raw("? as description_group", [
        normalizeLegacyDescriptionGroup(scope.descriptionGroup),
      ]),
      db.raw("min(nullif(lol.description, '')) as sample_description"),
      db.raw("count(*) as line_count"),
      db.raw("count(distinct lol.legacy_order_id) as order_count"),
      db.raw("count(distinct lo.medusa_customer_id) as customer_count"),
      db.raw("coalesce(sum(lol.quantity), 0) as total_quantity"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
      db.raw(
        "(array_agg(coalesce(lo.ref_number, lo.qbd_txn_id) order by lo.placed_at desc nulls last))[1] as last_order_ref"
      ),
      db.raw(
        "(array_agg(lo.customer_name order by lo.placed_at desc nulls last))[1] as last_customer_name"
      ),
      db.raw(
        "count(distinct nullif(btrim(coalesce(lol.description, '')), '')) as description_count"
      ),
    ])
    .groupBy(["lol.qbd_item_list_id", "lol.sku", "lol.title"])

  applyCandidateScope(query, scope)

  const row = await query.first()
  if (!row) {
    return null
  }

  const descriptions = await listTopDescriptions(db, row, 5)
  return serializeCandidate(row, descriptions)
}

async function listTopDescriptions(db: KnexLike, row: any, limit = 5) {
  const query = buildBaseLineQuery(db)
    .select([
      db.raw("coalesce(nullif(lol.description, ''), '') as description"),
      db.raw("count(*) as line_count"),
      db.raw("count(distinct lol.legacy_order_id) as order_count"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
    ])
    .groupByRaw("coalesce(nullif(lol.description, ''), '')")
    .orderByRaw("count(*) desc")
    .orderByRaw("max(lo.placed_at) desc nulls last")
    .limit(limit)

  applyCandidateScope(query, {
    qbdItemListId: row.qbd_item_list_id,
    sku: row.sku,
    title: row.title,
    descriptionGroup: row.description_group,
  })

  return query
}

export async function listLegacyItemMappingCandidates(
  db: KnexLike,
  filters: LegacyItemMappingCandidateQuery
) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100)
  const offset = Math.max(Number(filters.offset) || 0, 0)
  const minLines = Math.max(Number(filters.minLines) || 2, 1)
  const descriptionGroupExpression = descriptionGroupSql("lol")

  const grouped = buildBaseLineQuery(db, filters.q)
    .select([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      db.raw(`${descriptionGroupExpression.sql} as description_group`, [
        ...descriptionGroupExpression.bindings,
      ]),
      db.raw("min(nullif(lol.description, '')) as sample_description"),
      db.raw("count(*) as line_count"),
      db.raw("count(distinct lol.legacy_order_id) as order_count"),
      db.raw("count(distinct lo.medusa_customer_id) as customer_count"),
      db.raw("coalesce(sum(lol.quantity), 0) as total_quantity"),
      db.raw("max(lo.placed_at) as last_ordered_at"),
      db.raw(
        "(array_agg(coalesce(lo.ref_number, lo.qbd_txn_id) order by lo.placed_at desc nulls last))[1] as last_order_ref"
      ),
      db.raw(
        "(array_agg(lo.customer_name order by lo.placed_at desc nulls last))[1] as last_customer_name"
      ),
      db.raw(
        "count(distinct nullif(btrim(coalesce(lol.description, '')), '')) as description_count"
      ),
    ])
    .groupBy([
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      db.raw(descriptionGroupExpression.sql, [
        ...descriptionGroupExpression.bindings,
      ]),
    ])
    .havingRaw("count(*) >= ?", [minLines])

  const countRow = await db
    .from(grouped.clone().clearOrder().as("candidate_groups"))
    .count({ count: "*" })
    .first()

  const rows = await grouped
    .clone()
    .orderByRaw("count(*) desc")
    .orderByRaw("max(lo.placed_at) desc nulls last")
    .limit(limit)
    .offset(offset)

  const descriptionsByKey = new Map<string, any[]>()
  for (const row of rows) {
    descriptionsByKey.set(candidateKey(row), await listTopDescriptions(db, row, 5))
  }

  return {
    candidates: rows.map((row: any) =>
      serializeCandidate(row, descriptionsByKey.get(candidateKey(row)) ?? [])
    ),
    count: asNumber(countRow?.count),
    limit,
    offset,
    min_lines: minLines,
  }
}
