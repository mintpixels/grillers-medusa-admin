import path from "path"
import { generateEntityId } from "@medusajs/framework/utils"

type KnexLike = any

export type LegacyItemMappingInput = {
  qbdItemListId?: string | null
  qbdName?: string | null
  sku?: string | null
  descriptionContains?: string | null
  descriptionFingerprint?: string | null
  medusaVariantId?: string | null
  medusaSku?: string | null
  confidence?: number | string | null
  mappingSource?: string | null
  priority?: number | string | null
  sourceLabel?: string | null
  actorId?: string | null
  matchSkuWithQbdItemListId?: boolean
  metadata?: Record<string, unknown> | null
  dryRun?: boolean
}

export type LegacyItemMappingResult = {
  qbdItemListId: string | null
  sku: string | null
  variant: {
    variant_id: string
    sku: string | null
    variant_title: string | null
    product_id: string | null
    product_title: string | null
  }
  lineRowsBackfilled: number
  itemMapUpserted: boolean
  matchRuleUpserted: boolean
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function normalizeNumber(value: unknown, fallback: number): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  return fallback
}

function sourceFileName(sourceLabel: string | null) {
  if (!sourceLabel) {
    return "admin"
  }

  return path.basename(sourceLabel)
}

export async function findMedusaVariant(
  db: KnexLike,
  input: { variantId?: string | null; sku?: string | null }
) {
  const variantId = normalizeText(input.variantId)
  const sku = normalizeText(input.sku)

  const query = db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "p.title as product_title",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder.whereNull("p.deleted_at").orWhereNull("p.id")
    })

  if (variantId) {
    return query.clone().where("pv.id", variantId).first()
  }

  if (sku) {
    return query.clone().whereRaw("lower(pv.sku) = lower(?)", [sku]).first()
  }

  return null
}

export function buildLegacyLineBackfillQuery(
  db: KnexLike,
  input: {
    qbdItemListId?: string | null
    sku?: string | null
    descriptionContains?: string | null
    descriptionFingerprint?: string | null
    matchSkuWithQbdItemListId?: boolean
  }
) {
  const qbdItemListId = normalizeText(input.qbdItemListId)
  const sku = normalizeText(input.sku)
  const descriptionContains = normalizeText(input.descriptionContains)
  const descriptionFingerprint = normalizeText(input.descriptionFingerprint)
  const matchSkuWithQbdItemListId = Boolean(input.matchSkuWithQbdItemListId)

  return db("legacy_order_line")
    .whereNull("deleted_at")
    .andWhere((builder: any) => {
      if (qbdItemListId) {
        builder.where("qbd_item_list_id", qbdItemListId)
      }

      if (sku && (!qbdItemListId || matchSkuWithQbdItemListId)) {
        builder.orWhereRaw("lower(sku) = lower(?)", [sku])
      }
    })
    .modify((builder: any) => {
      if (descriptionContains) {
        builder.andWhereRaw(
          "position(lower(?) in lower(coalesce(description, ''))) > 0",
          [descriptionContains]
        )
      }

      if (descriptionFingerprint) {
        builder.andWhereRaw(
          "regexp_replace(lower(coalesce(description, '')), '[^a-z0-9]+', ' ', 'g') = regexp_replace(lower(?), '[^a-z0-9]+', ' ', 'g')",
          [descriptionFingerprint]
        )
      }
    })
    .andWhere((builder: any) => {
      builder
        .whereIn("mapping_status", ["mapped", "unmapped", "staff_assisted"])
        .orWhereRaw("metadata->>? = ?", ["line_kind", "product"])
    })
}

function whereNullableText(query: any, column: string, value: string | null) {
  if (value) {
    query.where(column, value)
  } else {
    query.whereNull(column)
  }
}

async function findExistingMatchRule(
  db: KnexLike,
  input: {
    qbdItemListId: string | null
    sku: string | null
    descriptionContains: string | null
    descriptionFingerprint: string | null
  }
) {
  const query = db("legacy_item_match_rule")
    .select("id")
    .whereNull("deleted_at")

  whereNullableText(query, "qbd_item_list_id", input.qbdItemListId)
  whereNullableText(query, "sku", input.sku)
  whereNullableText(query, "description_contains", input.descriptionContains)
  whereNullableText(query, "description_fingerprint", input.descriptionFingerprint)

  return query.first()
}

export async function upsertLegacyItemMapping(
  db: KnexLike,
  input: LegacyItemMappingInput
): Promise<LegacyItemMappingResult> {
  const qbdItemListId = normalizeText(input.qbdItemListId)
  const qbdName = normalizeText(input.qbdName)
  const descriptionContains = normalizeText(input.descriptionContains)
  const descriptionFingerprint = normalizeText(input.descriptionFingerprint)
  const usesMatchRule = Boolean(descriptionContains || descriptionFingerprint)
  const confidence = normalizeNumber(input.confidence, 1)
  const priority = normalizeNumber(input.priority, 100)
  const mappingSource = normalizeText(input.mappingSource) || "manual_admin"
  const sourceLabel = sourceFileName(normalizeText(input.sourceLabel))
  const now = new Date()
  const dryRun = Boolean(input.dryRun)
  const variant = await findMedusaVariant(db, {
    variantId: input.medusaVariantId,
    sku: input.medusaSku,
  })

  if (!variant) {
    throw new Error(
      `variant not found for ${normalizeText(input.medusaVariantId) || normalizeText(input.medusaSku) || "blank target"}`
    )
  }

  const sku = normalizeText(input.sku) || normalizeText(variant.sku)

  if (!qbdItemListId && !sku && !descriptionContains && !descriptionFingerprint) {
    throw new Error("mapping requires qbd_item_list_id, sku, or a description matcher")
  }

  if (usesMatchRule && !qbdItemListId && !sku) {
    throw new Error("description match rules require qbd_item_list_id or sku scope")
  }

  const lineQuery = buildLegacyLineBackfillQuery(db, {
    qbdItemListId,
    sku,
    descriptionContains,
    descriptionFingerprint,
    matchSkuWithQbdItemListId: input.matchSkuWithQbdItemListId,
  })

  if (dryRun) {
    const [{ count }] = await lineQuery.clone().count({ count: "*" })
    return {
      qbdItemListId,
      sku,
      variant,
      lineRowsBackfilled: Number(count) || 0,
      itemMapUpserted: !usesMatchRule && Boolean(qbdItemListId),
      matchRuleUpserted: usesMatchRule,
    }
  }

  if (usesMatchRule) {
    const existingRule = await findExistingMatchRule(db, {
      qbdItemListId,
      sku,
      descriptionContains,
      descriptionFingerprint,
    })
    const ruleRow = {
      source: "quickbooks_desktop",
      priority,
      qbd_item_list_id: qbdItemListId,
      sku,
      description_contains: descriptionContains,
      description_fingerprint: descriptionFingerprint,
      medusa_product_id: variant.product_id,
      medusa_variant_id: variant.variant_id,
      medusa_product_title: variant.product_title,
      medusa_variant_title: variant.variant_title,
      confidence,
      mapping_source: mappingSource,
      last_seen_at: now,
      metadata: {
        imported_from: sourceLabel,
        imported_by: "legacy-item-mapping",
        actor_id: normalizeText(input.actorId),
        ...(input.metadata || {}),
      },
      updated_at: now,
    }

    if (existingRule) {
      await db("legacy_item_match_rule").where({ id: existingRule.id }).update(ruleRow)
    } else {
      await db("legacy_item_match_rule").insert({
        id: generateEntityId(undefined, "lgimrule"),
        ...ruleRow,
        created_at: now,
      })
    }
  } else if (qbdItemListId) {
    const existing = await db("legacy_item_map")
      .select("id")
      .where("qbd_item_list_id", qbdItemListId)
      .whereNull("deleted_at")
      .first()
    const mapRow = {
      qbd_name: qbdName,
      sku,
      medusa_product_id: variant.product_id,
      medusa_variant_id: variant.variant_id,
      medusa_product_title: variant.product_title,
      medusa_variant_title: variant.variant_title,
      confidence,
      mapping_source: mappingSource,
      last_seen_at: now,
      metadata: {
        imported_from: sourceLabel,
        imported_by: "legacy-item-mapping",
        actor_id: normalizeText(input.actorId),
        ...(input.metadata || {}),
      },
      updated_at: now,
    }

    if (existing) {
      await db("legacy_item_map").where({ id: existing.id }).update(mapRow)
    } else {
      await db("legacy_item_map").insert({
        id: generateEntityId(undefined, "lgimap"),
        qbd_item_list_id: qbdItemListId,
        ...mapRow,
        created_at: now,
      })
    }
  }

  const lineRowsBackfilled = await lineQuery.update({
    medusa_product_id: variant.product_id,
    medusa_variant_id: variant.variant_id,
    medusa_product_title: variant.product_title,
    medusa_variant_title: variant.variant_title,
    mapping_status: "mapped",
    metadata: db.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
      JSON.stringify({
        line_kind: "product",
        mapping_confidence: confidence,
        mapping_source: mappingSource,
        mapping_imported_from: sourceLabel,
        mapping_actor_id: normalizeText(input.actorId),
      }),
    ]),
    updated_at: now,
  })

  return {
    qbdItemListId,
    sku,
    variant,
    lineRowsBackfilled: Number(lineRowsBackfilled) || 0,
    itemMapUpserted: !usesMatchRule && Boolean(qbdItemListId),
    matchRuleUpserted: usesMatchRule,
  }
}
