import { randomUUID } from "crypto"

export const PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE =
  "setup_then_final_charge"
export const SYSTEM_PAYMENT_PROVIDER_ID = "pp_system_default"
export const FINALIZATION_PENDING_PACK = "pending_pack"
export const FINALIZATION_PACKING = "packing"
export const FINALIZATION_PACKED_PENDING_REVIEW = "packed_pending_review"
export const FINALIZATION_PACKED_PENDING_CHARGE = "packed_pending_charge"
export const FINALIZATION_CHARGE_ATTEMPTING = "charge_attempting"
export const FINALIZATION_CHARGE_FAILED_HOLD = "charge_failed_hold"
export const FINALIZATION_CHARGED_READY_TO_SHIP = "charged_ready_to_ship"
export const FINALIZATION_RELEASED_TO_FULFILLMENT = "released_to_fulfillment"

export const CATCH_WEIGHT_ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "created_at",
  "currency_code",
  "customer_id",
  "cart_id",
  "status",
  "fulfillment_status",
  "payment_status",
  "total",
  "subtotal",
  "item_subtotal",
  "shipping_total",
  "tax_total",
  "discount_total",
  "raw_total",
  "raw_subtotal",
  "raw_item_subtotal",
  "raw_shipping_total",
  "raw_tax_total",
  "raw_discount_total",
  "metadata",
  "shipping_address.*",
  "billing_address.*",
  "shipping_methods.*",
  "fulfillments.id",
  "fulfillments.status",
  "fulfillments.canceled_at",
  "fulfillments.shipped_at",
  "fulfillments.delivered_at",
  "fulfillments.created_at",
  "items.id",
  "items.title",
  "items.subtitle",
  "items.product_id",
  "items.variant_id",
  "items.variant_sku",
  "items.quantity",
  "items.unit_price",
  "items.subtotal",
  "items.tax_total",
  "items.total",
  "items.raw_quantity",
  "items.raw_unit_price",
  "items.raw_subtotal",
  "items.raw_tax_total",
  "items.raw_total",
  "items.metadata",
  "items.detail.quantity",
  "items.detail.raw_quantity",
  "items.detail.unit_price",
  "items.detail.raw_unit_price",
  "items.detail.subtotal",
  "items.detail.raw_subtotal",
  "items.detail.tax_total",
  "items.detail.raw_tax_total",
  "items.detail.total",
  "items.detail.raw_total",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.metadata",
  "items.variant.product.id",
  "items.variant.product.metadata",
  "payment_collections.id",
  "payment_collections.payments.id",
  "payment_collections.payments.amount",
  "payment_collections.payments.currency_code",
  "payment_collections.payments.provider_id",
]

export type CatchWeightDb = (table: string) => any

type FinalizationLinePatch = {
  actual_quantity?: number | string | null
  actual_piece_count?: number | string | null
  actual_weight_each?: number | string | null
  actual_weight_total?: number | string | null
  actual_unit_price?: number | string | null
  final_line_subtotal?: number | string | null
  final_line_total?: number | string | null
  status?: string | null
  replacement_variant_id?: string | null
  replacement_qbd_list_id?: string | null
  replacement_reason?: string | null
  short_reason?: string | null
  exception_reason?: string | null
  manager_override_reason?: string | null
  note?: string | null
  metadata?: Record<string, any> | null
}

type StripePaymentIntent = {
  id: string
  status?: string
  latest_charge?: string | null
  charges?: { data?: Array<{ id?: string }> }
  last_payment_error?: {
    code?: string
    message?: string
  } | null
}

const nullableNumber = (value: unknown): number | null => {
  if (value === undefined || value === null || value === "") return null
  const amount =
    typeof value === "object" && value !== null && "value" in value
      ? Number((value as { value: unknown }).value)
      : Number(value)

  if (!Number.isFinite(amount)) return null
  return amount
}

const numberOrZero = (value: unknown): number => nullableNumber(value) ?? 0

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100

const id = (prefix: string) => `${prefix}_${randomUUID()}`

export const metadataObject = (value: unknown): Record<string, any> => {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {}
    } catch {
      return {}
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, any>) }
  }
  return {}
}

export const appendStaffAudit = (
  metadata: Record<string, any>,
  entry: Record<string, any>
) => {
  const raw = metadata.staff_audit_log
  let audit: Array<Record<string, any>> = []

  if (Array.isArray(raw)) {
    audit = raw
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      audit = Array.isArray(parsed) ? parsed : []
    } catch {
      audit = []
    }
  }

  return {
    ...metadata,
    staff_audit_log: JSON.stringify(
      [
        ...audit,
        {
          at: new Date().toISOString(),
          ...entry,
        },
      ].slice(-75)
    ),
  }
}

export const amountInMinorUnits = (
  amount: number,
  currencyCode = "usd"
): number => {
  const zeroDecimalCurrencies = new Set([
    "bif",
    "clp",
    "djf",
    "gnf",
    "jpy",
    "kmf",
    "krw",
    "mga",
    "pyg",
    "rwf",
    "ugx",
    "vnd",
    "vuv",
    "xaf",
    "xof",
    "xpf",
  ])
  return zeroDecimalCurrencies.has(currencyCode.toLowerCase())
    ? Math.round(amount)
    : Math.round(amount * 100)
}

export const orderRequiresFinalCharge = (order: Record<string, any>) => {
  const metadata = metadataObject(order?.metadata)
  return metadata.payment_workflow === PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE
}

export const finalChargeSucceeded = (orderOrMetadata: Record<string, any>) => {
  const metadata =
    "payment_workflow" in orderOrMetadata || "final_charge_status" in orderOrMetadata
      ? orderOrMetadata
      : metadataObject(orderOrMetadata.metadata)

  return (
    metadata.final_charge_status === "succeeded" ||
    metadata.finalization_status === FINALIZATION_CHARGED_READY_TO_SHIP ||
    metadata.finalization_status === FINALIZATION_RELEASED_TO_FULFILLMENT ||
    metadata.fulfillment_gate_status === "released"
  )
}

export const fulfillmentGateAllowsShipment = (
  order: Record<string, any> | null | undefined
) => {
  if (!order) return true
  return !orderRequiresFinalCharge(order) || finalChargeSucceeded(order)
}

export const orderPlacedFinalizationMetadata = (
  order: Record<string, any>,
  finalization: Record<string, any>
) => {
  const metadata = metadataObject(order.metadata)
  const hasSavedCard =
    Boolean(metadata.stripe_payment_method_id) ||
    metadata.payment_setup_status === "saved"

  return {
    ...metadata,
    payment_workflow:
      metadata.payment_workflow || PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
    payment_setup_status:
      metadata.payment_setup_status ||
      (hasSavedCard ? "saved" : "missing_saved_card"),
    catch_weight_status: metadata.catch_weight_status || FINALIZATION_PENDING_PACK,
    finalization_id: finalization.id,
    finalization_status: finalization.status,
    final_charge_status: metadata.final_charge_status || "not_started",
    fulfillment_gate_status:
      metadata.fulfillment_gate_status || "blocked_until_final_charge",
    estimated_total:
      metadata.estimated_total ?? finalization.estimated_order_total ?? order.total,
  }
}

const valueAtPath = (source: Record<string, any>, path: string) => {
  if (!path.includes(".")) return source?.[path]
  return path.split(".").reduce((current: any, segment) => {
    if (current === undefined || current === null) return undefined
    return current[segment]
  }, source)
}

const fieldAmount = (source: Record<string, any>, names: string[]) => {
  for (const name of names) {
    const value = nullableNumber(valueAtPath(source, name))
    if (value !== null) return value
  }
  return 0
}

const lower = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : ""

const cleanText = (value: unknown): string | null => {
  const text = String(value ?? "").trim()
  return text === "" ? null : text
}

const stripEmbeddedPrice = (value: string): string =>
  value
    .replace(
      /\s*@\s*\$?\d+(?:\.\d+)?\s*\/?\s*(?:lb|lbs|oz|kg|g|each|ea)\.?/gi,
      ""
    )
    .replace(
      /\s*\$\s?\d+(?:\.\d+)?\s*\/\s*(?:lb|lbs|oz|kg|g|each|ea)\.?/gi,
      ""
    )
    .replace(/\s+@\s*$/g, "")

const titleCaseLegacyWords = (value: string): string =>
  value
    .replace(/\b[A-Z]{3,}\b/g, (word) =>
      ["USDA", "KFP", "OU", "MSG"].includes(word)
        ? word
        : word[0] + word.slice(1).toLowerCase()
    )
    .replace(/\bBnls\b/gi, "Boneless")
    .replace(/\bLb\b/g, "lb")
    .replace(/\bOz\b/g, "oz")

const stripLegacyDescriptors = (value: string): string =>
  value
    .replace(/\s*\((?:alle)\)\s*/gi, " ")
    .replace(/\bInstitutional\b\.?/gi, " ")
    .replace(/\bAmerican\s+Angus\b\.?/gi, " ")
    .replace(/\bVacuum\s+Pack\b\.?/gi, " ")
    .replace(/\bUncooked\b\.?/gi, " ")
    .replace(/\bNOT\s+Kosher\s+for\s+Passover\.?/gi, " ")
    .replace(/\bKosher\s+for\s+Passover\b\.?/gi, " ")
    .replace(/\bKFP\b\.?/gi, " ")
    .replace(/\bNO\s+MSG\b\.?/gi, " ")
    .replace(/\bNOT\s+Gluten\s+Free\.?/gi, " ")
    .replace(/\bFresh\s+Beef\s+Choice\s+Per\s+LB\b\.?/gi, " ")
    .replace(/\bProduced\s+from\b[^,.]*[,.]?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

const shortenLegacyDescriptionTitle = (value: string): string => {
  const commaIndex = value.indexOf(",")
  if (commaIndex <= 3) return value

  const head = value.slice(0, commaIndex).trim()
  const tail = value.slice(commaIndex + 1).trim().toLowerCase()

  if (
    head.length >= 4 &&
    (tail.startsWith("with ") ||
      tail.startsWith("in ") ||
      (value.length > 72 && !/^\(?\d{1,3}\s*\/\s*\d{1,3}\)?\b/.test(tail)))
  ) {
    return head
  }

  return value
}

const formatGroundBeefPackTitle = (value: string): string | null => {
  const match = value.match(
    /^(\d+(?:\.\d+)?)\s*lb\.?\s*(pack|tube)\s+ground\s+beef(?:[\s,]+((?:extra\s+lean\s+)?\d{1,3}\s*\/\s*\d{1,3}))?/i
  )

  if (!match?.[1] || !match?.[2] || !match?.[3]) return null

  const amount = match[1]
  const packageType = match[2].toLowerCase() === "tube" ? "Tube" : "Pack"
  const ratio = match[3]
    .replace(/\bextra\s+lean\b/i, "Extra Lean")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s{2,}/g, " ")
    .trim()

  return `Ground Beef ${ratio} - ${amount} lb ${packageType}`
}

const formatVealScallopiniTitle = (value: string): string | null => {
  const match = value.match(
    /^(?:kosher\s+)?veal\s+scallopini(?:,\s*(\d{1,2}\s*-\s*\d{1,2})\s*slices?)?(?:,\s*~?\s*(\d+(?:\.\d+)?)\s*lb\.?)?/i
  )

  if (!match) return null

  const amount = match[2] || "1"
  const slices = match[1]?.replace(/\s+/g, "")
  return `Veal Scallopini - ${amount} lb${slices ? ` (${slices} slices)` : ""}`
}

const looksLikeAccountingTitle = (value: string | null): boolean => {
  if (!value) return false

  const title = value.toLowerCase()

  return (
    /\binstitutional\b/.test(title) ||
    /\bvacuum\s+pack\b/.test(title) ||
    /\buncooked\b/.test(title) ||
    /\bkosher\s+for\s+passover\b/.test(title) ||
    /\bnot kosher for passover\b/.test(title) ||
    /\bno\s+msg\b/.test(title) ||
    /\bnot\s+gluten\s+free\b/.test(title) ||
    /\bamerican\s+angus\b/.test(title) ||
    /\bproduced\s+from\b/.test(title) ||
    /\bfresh beef choice per lb\b/.test(title) ||
    /,\s*(?:with|in)\s+/.test(title) ||
    /@\s*\$?\d+(?:\.\d+)?\s*\/?\s*lb\.?/.test(title) ||
    /\$\s?\d+(?:\.\d+)?\s*\/\s*(?:lb|lbs|oz|kg|g|each|ea)\.?/.test(title) ||
    (/^[A-Z0-9\s,./()&'-]{12,}$/.test(value) && /[A-Z]{3,}/.test(value)) ||
    (title.length > 72 && /\b(per lb|uncooked|choice|alle)\b/.test(title))
  )
}

const cleanLegacyCustomerTitle = (value: string | null): string | null => {
  const text = cleanText(value)
  if (!text) return null

  const shouldClean =
    looksLikeAccountingTitle(text) ||
    /\$\s?\d+(?:\.\d+)?\s*\/\s*(?:lb|lbs|oz|kg|g|each|ea)\.?/i.test(text) ||
    /\s*@\s*\$?\d+(?:\.\d+)?\s*\/?\s*(?:lb|lbs|oz|kg|g|each|ea)\.?/i.test(text)

  if (!shouldClean) return text

  const stripped = stripLegacyDescriptors(stripEmbeddedPrice(text))
  const shortened = shortenLegacyDescriptionTitle(stripped)
  const segments = shortened
    .split(",")
    .map((segment) =>
      segment
        .replace(/^[\s,.;:/-]+|[\s,.;:/-]+$/g, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter((segment) => {
      if (!segment) return false
      const value = segment.toLowerCase()
      return (
        value !== "uncooked" &&
        value !== "institutional" &&
        value !== "not kosher for passover"
      )
    })

  const joined = segments.join(", ") || shortened || stripped
  const groundBeefTitle = formatGroundBeefPackTitle(joined)
  if (groundBeefTitle) return groundBeefTitle
  const vealScallopiniTitle = formatVealScallopiniTitle(joined)
  if (vealScallopiniTitle) return vealScallopiniTitle

  const cleaned = titleCaseLegacyWords(joined)
    .replace(/\blb\./gi, "lb")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,.;:-]+$/g, "")
    .trim()

  return cleaned || text
}

const metadataValue = (
  metadata: Record<string, any>,
  names: string[]
): unknown => {
  for (const name of names) {
    if (metadata[name] !== undefined && metadata[name] !== null) {
      return metadata[name]
    }
  }
  return undefined
}

const itemSearchText = (item: Record<string, any>) =>
  [
    item.title,
    item.subtitle,
    item.product_title,
    item.variant_title,
    item.description,
    item.metadata?.title,
    item.metadata?.customer_title,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase()

const explicitPoundWeightFromText = (text: string) => {
  const match = text.match(
    /(?:^|\b|[~≈])\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/
  )
  if (!match) return null

  const pounds = Number(match[1])
  return Number.isFinite(pounds) && pounds > 0 ? pounds : null
}

const combinedLineMetadata = (item: Record<string, any>) => ({
  ...metadataObject(item?.variant?.product?.metadata),
  ...metadataObject(item?.product?.metadata),
  ...metadataObject(item?.variant?.metadata),
  ...metadataObject(item?.metadata),
})

const pricingModeFromItem = (item: Record<string, any>) => {
  const metadata = combinedLineMetadata(item)
  const raw = lower(
    metadataValue(metadata, [
      "pricing_mode",
      "PricingMode",
      "net_weight_pricing_mode",
      "catch_weight_pricing_mode",
      "price_type",
    ])
  )

  if (
    raw === "per_lb" ||
    raw === "per-pound" ||
    raw === "per pound" ||
    raw === "catch_weight" ||
    raw === "catch-weight"
  ) {
    return "per_lb"
  }

  if (
    metadata.catch_weight === true ||
    metadata.is_catch_weight === true ||
    metadata.RequiresCatchWeight === true
  ) {
    return "per_lb"
  }

  const text = itemSearchText(item)
  if (
    /\$\s*\d+(?:\.\d+)?\s*\/\s*lb\b/.test(text) ||
    /\b(per|\/)\s*lb\b/.test(text) ||
    /\bper\s+pound\b/.test(text) ||
    explicitPoundWeightFromText(text) !== null
  ) {
    return "per_lb"
  }

  return "fixed_price"
}

const qbdListIdFromItem = (item: Record<string, any>) => {
  const metadata = combinedLineMetadata(item)
  const value = metadataValue(metadata, [
    "qbd_list_id",
    "quickbooks_list_id",
    "qb_list_id",
    "qbd_item_list_id",
    "quickbooks_item_list_id",
    "QuickBooksListId",
  ])
  return typeof value === "string" && value.trim() ? value.trim() : null
}

const customerTitleFromItem = (item: Record<string, any>) => {
  const metadata = combinedLineMetadata(item)
  const variant = metadataObject(item.variant)
  const product = metadataObject(item.product)
  const variantProduct = metadataObject(variant.product)
  const raw =
    cleanText(metadata.strapi_title) ||
    cleanText(metadata.display_title) ||
    cleanText(metadata.customer_title) ||
    cleanText(metadata.medusa_product_title) ||
    cleanText(item.product_title) ||
    cleanText(variantProduct.title) ||
    cleanText(product.title) ||
    cleanText(variant.title) ||
    cleanText(item.title)

  return cleanLegacyCustomerTitle(raw) || raw || null
}

const parseWeight = (value: unknown): number | null => {
  const direct = nullableNumber(value)
  if (direct !== null && direct > 0) return direct
  if (typeof value !== "string") return null

  const text = value.toLowerCase()
  const range = text.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/)
  const single = text.match(/(\d+(?:\.\d+)?)/)
  let pounds: number | null = null

  if (range) {
    pounds = (Number(range[1]) + Number(range[2])) / 2
  } else if (single) {
    pounds = Number(single[1])
  }

  if (!pounds || !Number.isFinite(pounds)) return null
  return text.includes("oz") || text.includes("ounce")
    ? roundMoney(pounds / 16)
    : pounds
}

const estimatedWeightEachFromItem = (item: Record<string, any>) => {
  const metadata = combinedLineMetadata(item)
  const value = metadataValue(metadata, [
    "estimated_weight_each",
    "approximate_pack_weight",
    "ApproximatePackWeight",
    "pack_weight",
    "net_weight",
    "NetWeight",
  ])
  const metadataWeight = parseWeight(value)
  if (metadataWeight !== null) return metadataWeight

  const text = itemSearchText(item)
  const approximate = text.match(
    /[~≈]\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pound|pounds)\b/
  )
  if (approximate) return Number(approximate[1])

  const explicit = explicitPoundWeightFromText(text)
  if (explicit !== null) return explicit

  return null
}

const orderBreakdown = (order: Record<string, any>) => {
  const estimatedItemTotal = fieldAmount(order, [
    "item_subtotal",
    "subtotal",
    "raw_item_subtotal",
    "raw_subtotal",
  ])
  const estimatedShippingTotal = fieldAmount(order, [
    "shipping_total",
    "raw_shipping_total",
  ])
  const estimatedTaxTotal = fieldAmount(order, ["tax_total", "raw_tax_total"])
  const estimatedDiscountTotal = fieldAmount(order, [
    "discount_total",
    "raw_discount_total",
  ])
  const estimatedOrderTotal = fieldAmount(order, [
    "total",
    "raw_total",
    "summary.current_order_total",
  ])

  return {
    estimated_item_total: estimatedItemTotal,
    estimated_shipping_total: estimatedShippingTotal,
    estimated_tax_total: estimatedTaxTotal,
    estimated_discount_total: estimatedDiscountTotal,
    estimated_order_total: estimatedOrderTotal,
  }
}

const lineEstimate = (item: Record<string, any>) => {
  const quantity = fieldAmount(item, [
    "quantity",
    "raw_quantity",
    "detail.quantity",
    "detail.raw_quantity",
  ])
  const unitPrice = fieldAmount(item, [
    "unit_price",
    "raw_unit_price",
    "detail.unit_price",
    "detail.raw_unit_price",
  ])
  const subtotal =
    fieldAmount(item, [
      "subtotal",
      "raw_subtotal",
      "detail.subtotal",
      "detail.raw_subtotal",
    ]) ||
    roundMoney(unitPrice * quantity)
  const total =
    fieldAmount(item, [
      "total",
      "raw_total",
      "detail.total",
      "detail.raw_total",
    ]) || subtotal
  const tax = fieldAmount(item, [
    "tax_total",
    "raw_tax_total",
    "detail.tax_total",
    "detail.raw_tax_total",
  ])

  return { quantity, unitPrice, subtotal, total, tax }
}

export const buildFinalizationLineSnapshot = (
  order: Record<string, any>,
  item: Record<string, any>,
  finalizationId: string
) => {
  const estimate = lineEstimate(item)
  const estimatedWeightEach = estimatedWeightEachFromItem(item)
  const estimatedWeightTotal =
    estimatedWeightEach !== null
      ? roundMoney(estimatedWeightEach * estimate.quantity)
      : null
  const pricingMode = pricingModeFromItem(item)

  return {
    id: id("gpfinline"),
    finalization_id: finalizationId,
    order_id: order.id,
    line_item_id: item.id,
    product_id: item.product_id || item.product?.id || null,
    variant_id: item.variant_id || item.variant?.id || null,
    sku: item.variant_sku || item.sku || item.variant?.sku || null,
    qbd_list_id: qbdListIdFromItem(item),
    title_snapshot: item.title || item.product_title || item.subtitle || null,
    customer_title: customerTitleFromItem(item),
    pricing_mode: pricingMode,
    unit_price: estimate.unitPrice,
    estimated_unit_price: estimate.unitPrice,
    estimated_line_total: estimate.total,
    ordered_quantity: estimate.quantity,
    estimated_weight_each: estimatedWeightEach,
    estimated_weight_total: estimatedWeightTotal,
    actual_quantity: estimate.quantity,
    actual_piece_count: estimate.quantity,
    actual_unit_price: estimate.unitPrice,
    final_line_subtotal: pricingMode === "per_lb" ? null : estimate.subtotal,
    final_line_total: pricingMode === "per_lb" ? null : estimate.total,
    delta_line_total: pricingMode === "per_lb" ? null : 0,
    status: pricingMode === "per_lb" ? "needs_weight" : "ready",
    metadata: {
      estimated_tax_total: estimate.tax,
      estimated_line_subtotal: estimate.subtotal,
      estimated_line_total: estimate.total,
      source_line_metadata: metadataObject(item.metadata),
    },
    created_at: new Date(),
    updated_at: new Date(),
  }
}

const existingLineRepairPatch = (
  existing: Record<string, any>,
  snapshot: Record<string, any>
) => {
  const patch: Record<string, any> = {}
  const copyIfMissingOrZero = [
    "product_id",
    "variant_id",
    "sku",
    "qbd_list_id",
    "title_snapshot",
    "customer_title",
    "unit_price",
    "estimated_unit_price",
    "estimated_line_total",
    "ordered_quantity",
    "estimated_weight_each",
    "estimated_weight_total",
  ]

  for (const field of copyIfMissingOrZero) {
    const current = existing[field]
    const next = snapshot[field]
    if (
      next !== undefined &&
      next !== null &&
      (current === undefined ||
        current === null ||
        current === "" ||
        Number(current) === 0)
    ) {
      patch[field] = next
    }
  }

  Object.assign(patch, customerTitleRepairPatch(existing, snapshot))

  if (
    snapshot.actual_quantity &&
    (!existing.actual_quantity || Number(existing.actual_quantity) === 0)
  ) {
    patch.actual_quantity = snapshot.actual_quantity
  }

  if (
    snapshot.actual_piece_count &&
    (!existing.actual_piece_count || Number(existing.actual_piece_count) === 0)
  ) {
    patch.actual_piece_count = snapshot.actual_piece_count
  }

  if (snapshot.pricing_mode === "per_lb" && existing.pricing_mode !== "per_lb") {
    patch.pricing_mode = "per_lb"
    patch.final_line_subtotal = null
    patch.final_line_total = null
    patch.delta_line_total = null
    if (!nullableNumber(existing.actual_weight_total)) {
      patch.status = "needs_weight"
    }
  }

  const currentMetadata = metadataObject(existing.metadata)
  const snapshotMetadata = metadataObject(snapshot.metadata)
  const shouldRepairMetadata = Object.entries(snapshotMetadata).some(
    ([field, next]) => {
      const current = currentMetadata[field]
      if (field === "source_line_metadata") {
        return (
          Object.keys(metadataObject(next)).length > 0 &&
          Object.keys(metadataObject(current)).length === 0
        )
      }
      return (
        next !== undefined &&
        next !== null &&
        (current === undefined ||
          current === null ||
          current === "" ||
          Number(current) === 0)
      )
    }
  )
  if (shouldRepairMetadata) {
    const mergedMetadata: Record<string, any> = { ...currentMetadata }
    for (const [field, next] of Object.entries(snapshotMetadata)) {
      if (field === "source_line_metadata") continue
      const current = currentMetadata[field]
      if (
        next !== undefined &&
        next !== null &&
        (current === undefined ||
          current === null ||
          current === "" ||
          Number(current) === 0)
      ) {
        mergedMetadata[field] = next
      }
    }
    mergedMetadata.source_line_metadata = {
      ...metadataObject(snapshotMetadata.source_line_metadata),
      ...metadataObject(currentMetadata.source_line_metadata),
    }
    patch.metadata = mergedMetadata
  }

  if (Object.keys(patch).length) {
    patch.updated_at = new Date()
  }

  return patch
}

const customerTitleRepairPatch = (
  existing: Record<string, any>,
  snapshot: Record<string, any>
) => {
  const patch: Record<string, any> = {}
  const currentCustomerTitle = cleanText(existing.customer_title)
  const nextCustomerTitle = cleanText(snapshot.customer_title)
  const currentTitleSnapshot = cleanText(existing.title_snapshot)
  const nextTitleSnapshot = cleanText(snapshot.title_snapshot)
  if (
    nextCustomerTitle &&
    currentCustomerTitle !== nextCustomerTitle &&
    (!currentCustomerTitle ||
      currentCustomerTitle === currentTitleSnapshot ||
      currentCustomerTitle === nextTitleSnapshot ||
      looksLikeAccountingTitle(currentCustomerTitle) ||
      cleanLegacyCustomerTitle(currentCustomerTitle) !== currentCustomerTitle)
  ) {
    patch.customer_title = nextCustomerTitle
  }

  return patch
}

export async function ensurePaymentSetup(
  db: CatchWeightDb,
  input: {
    order: Record<string, any>
    cartId?: string | null
    customerId?: string | null
    customerEmail?: string | null
    stripeCustomerId?: string | null
    stripePaymentMethodId: string
    setupIntentId?: string | null
    accountHolderId?: string | null
    consentVersion?: string | null
    consentText?: string | null
    consentedAt?: Date | string | null
    metadata?: Record<string, any>
  }
) {
  const existing = await db("gp_order_payment_setup")
    .where({ order_id: input.order.id })
    .whereNull("deleted_at")
    .first()

  const row = {
    cart_id: input.cartId || input.order.cart_id || null,
    customer_id: input.customerId || input.order.customer_id || null,
    customer_email: input.customerEmail || input.order.email || null,
    stripe_customer_id: input.stripeCustomerId || null,
    stripe_payment_method_id: input.stripePaymentMethodId,
    setup_intent_id: input.setupIntentId || null,
    account_holder_id: input.accountHolderId || null,
    status: "saved",
    consent_version: input.consentVersion || null,
    consent_text: input.consentText || null,
    consented_at: input.consentedAt || new Date(),
    metadata: input.metadata || {},
    updated_at: new Date(),
  }

  if (existing) {
    await db("gp_order_payment_setup").where({ id: existing.id }).update(row)
    return { ...existing, ...row }
  }

  const inserted = {
    id: id("gpsetup"),
    order_id: input.order.id,
    ...row,
    created_at: new Date(),
  }
  await db("gp_order_payment_setup").insert(inserted)
  return inserted
}

export async function ensureFinalizationForOrder(
  db: CatchWeightDb,
  order: Record<string, any>,
  status = FINALIZATION_PENDING_PACK
) {
  const existing = await db("gp_order_finalization")
    .where({ order_id: order.id })
    .whereNull("deleted_at")
    .first()

  const breakdown = orderBreakdown(order)
  const metadata = metadataObject(order.metadata)

  const base = {
    cart_id: order.cart_id || metadata.cart_id || null,
    customer_id: order.customer_id || null,
    customer_email: order.email || null,
    display_id:
      order.display_id === undefined || order.display_id === null
        ? null
        : String(order.display_id),
    currency_code: order.currency_code || "usd",
    ...breakdown,
    updated_at: new Date(),
  }

  let finalization = existing
  if (!finalization) {
    finalization = {
      id: id("gpfin"),
      order_id: order.id,
      status,
      ...base,
      created_at: new Date(),
    }
    await db("gp_order_finalization").insert(finalization)
  } else {
    await db("gp_order_finalization")
      .where({ id: finalization.id })
      .update(base)
    finalization = { ...finalization, ...base }
  }

  const existingLines = await db("gp_order_finalization_line")
    .where({ finalization_id: finalization.id })
    .whereNull("deleted_at")

  const existingLineIds = new Set(
    (existingLines || []).map((line: Record<string, any>) => line.line_item_id)
  )
  const itemsById = new Map(
    (order.items || [])
      .filter((item: Record<string, any>) => item?.id)
      .map((item: Record<string, any>) => [item.id, item])
  )
  const repairableStatuses = new Set([
    FINALIZATION_PENDING_PACK,
    FINALIZATION_PACKING,
    FINALIZATION_PACKED_PENDING_REVIEW,
  ])
  const repairedLines = await Promise.all(
    (existingLines || []).map(async (line: Record<string, any>) => {
      const item = itemsById.get(line.line_item_id)
      if (!item) return line

      const snapshot = buildFinalizationLineSnapshot(order, item, finalization.id)
      const patch = repairableStatuses.has(finalization.status)
        ? existingLineRepairPatch(line, snapshot)
        : customerTitleRepairPatch(line, snapshot)
      if (!Object.keys(patch).length) return line

      await db("gp_order_finalization_line").where({ id: line.id }).update(patch)
      return { ...line, ...patch }
    })
  )
  const newLines = (order.items || [])
    .filter((item: Record<string, any>) => item?.id && !existingLineIds.has(item.id))
    .map((item: Record<string, any>) =>
      buildFinalizationLineSnapshot(order, item, finalization.id)
    )

  if (newLines.length) {
    await db("gp_order_finalization_line").insert(newLines)
  }

  const lines = [...repairedLines, ...newLines]
  return { finalization, lines }
}

export async function getFinalizationDetail(
  db: CatchWeightDb,
  order: Record<string, any>
) {
  const ensured = await ensureFinalizationForOrder(db, order)
  const paymentSetup = await db("gp_order_payment_setup")
    .where({ order_id: order.id })
    .whereNull("deleted_at")
    .first()
  const attempts = await db("gp_final_charge_attempt")
    .where({ order_id: order.id })
    .whereNull("deleted_at")
    .orderBy("created_at", "desc")

  return {
    ...ensured,
    payment_setup: paymentSetup || null,
    charge_attempts: attempts || [],
  }
}

const normalizedLinePatch = (body: FinalizationLinePatch) => {
  const patch: Record<string, any> = {}
  const numericFields = [
    "actual_quantity",
    "actual_piece_count",
    "actual_weight_each",
    "actual_weight_total",
    "actual_unit_price",
    "final_line_subtotal",
    "final_line_total",
  ]

  for (const field of numericFields) {
    if (field in body) {
      patch[field] = nullableNumber((body as Record<string, any>)[field])
    }
  }

  for (const field of [
    "status",
    "replacement_variant_id",
    "replacement_qbd_list_id",
    "replacement_reason",
    "short_reason",
    "exception_reason",
    "manager_override_reason",
    "note",
  ]) {
    if (field in body) {
      const value = (body as Record<string, any>)[field]
      patch[field] =
        value === undefined || value === null || value === "" ? null : String(value)
    }
  }

  if (body.metadata && typeof body.metadata === "object") {
    patch.metadata = body.metadata
  }

  return patch
}

export async function updateFinalizationLine(
  db: CatchWeightDb,
  orderId: string,
  lineId: string,
  body: FinalizationLinePatch
) {
  const patch = {
    ...normalizedLinePatch(body),
    updated_at: new Date(),
  }

  const line = await db("gp_order_finalization_line")
    .where({ order_id: orderId, line_item_id: lineId })
    .whereNull("deleted_at")
    .first()

  if (!line) {
    throw new Error("Finalization line was not found.")
  }

  await db("gp_order_finalization_line").where({ id: line.id }).update(patch)
  await db("gp_order_finalization")
    .where({ id: line.finalization_id })
    .update({
      status: FINALIZATION_PACKED_PENDING_REVIEW,
      updated_at: new Date(),
    })

  return { ...line, ...patch }
}

const calculateLine = (line: Record<string, any>) => {
  const pricingMode = line.pricing_mode || "fixed_price"
  const status = line.status || "needs_weight"
  const metadata = metadataObject(line.metadata)
  const estimatedSubtotal = numberOrZero(metadata.estimated_line_subtotal)
  const estimatedTotal = numberOrZero(
    line.estimated_line_total ?? metadata.estimated_line_total
  )
  const estimatedTax = numberOrZero(metadata.estimated_tax_total)
  const estimatedTaxRate =
    estimatedSubtotal > 0 ? estimatedTax / estimatedSubtotal : 0
  const unitPrice = numberOrZero(line.actual_unit_price ?? line.unit_price)
  const actualQuantity = numberOrZero(line.actual_quantity ?? line.ordered_quantity)
  const actualWeightTotal = nullableNumber(line.actual_weight_total)

  const persistedFinalSubtotal = nullableNumber(line.final_line_subtotal)
  let finalSubtotal: number | null =
    pricingMode === "per_lb" ? null : persistedFinalSubtotal
  const errors: string[] = []
  const warnings: string[] = []

  if (!line.qbd_list_id && !line.replacement_qbd_list_id) {
    errors.push("Missing QuickBooks ListID.")
  }

  if (status === "removed") {
    finalSubtotal = 0
    if (!line.short_reason && !line.exception_reason) {
      errors.push("Removed line requires a short/removal reason.")
    }
  } else if (status === "substituted") {
    if (!line.replacement_variant_id || !line.replacement_qbd_list_id) {
      errors.push("Substituted line requires replacement variant and QBD ListID.")
    }
    if (pricingMode === "per_lb") {
      if (!actualWeightTotal || actualWeightTotal <= 0) {
        finalSubtotal = null
        errors.push("Actual weight is required for per-lb items.")
      } else {
        finalSubtotal = roundMoney(actualWeightTotal * unitPrice)
      }
    } else if (
      finalSubtotal === null ||
      (finalSubtotal === 0 &&
        estimatedSubtotal > 0 &&
        unitPrice > 0 &&
        actualQuantity > 0)
    ) {
      finalSubtotal = roundMoney(actualQuantity * unitPrice)
    }
  } else if (pricingMode === "per_lb") {
    if (!actualWeightTotal || actualWeightTotal <= 0) {
      finalSubtotal = null
      errors.push("Actual weight is required for per-lb items.")
    } else {
      finalSubtotal = roundMoney(actualWeightTotal * unitPrice)
    }
  } else if (
    finalSubtotal === null ||
    (finalSubtotal === 0 &&
      estimatedSubtotal > 0 &&
      unitPrice > 0 &&
      actualQuantity > 0)
  ) {
    finalSubtotal = roundMoney(actualQuantity * unitPrice)
  }

  if (status !== "removed" && unitPrice <= 0) {
    errors.push("Final unit price is missing.")
  }

  const hasFinalSubtotal = finalSubtotal !== null
  const finalTax = hasFinalSubtotal
    ? roundMoney((finalSubtotal || 0) * estimatedTaxRate)
    : null
  const finalTotal = hasFinalSubtotal
    ? roundMoney((finalSubtotal || 0) + (finalTax || 0))
    : null
  const delta =
    finalTotal !== null ? roundMoney(finalTotal - estimatedTotal) : null

  if (delta !== null && Math.abs(delta) >= Math.max(15, estimatedTotal * 0.25)) {
    warnings.push("Large final price change needs staff review.")
  }

  return {
    line,
    final_line_subtotal: hasFinalSubtotal ? finalSubtotal || 0 : null,
    final_line_tax_total: finalTax,
    final_line_total: finalTotal,
    delta_line_total: delta,
    errors,
    warnings,
  }
}

export async function previewFinalization(
  db: CatchWeightDb,
  order: Record<string, any>,
  options: { persist?: boolean } = {}
) {
  const detail = await getFinalizationDetail(db, order)
  const breakdown = orderBreakdown(order)
  const calculatedLines = detail.lines.map(calculateLine)
  const lineErrors = calculatedLines.flatMap((line) =>
    line.errors.map((message) => ({
      line_item_id: line.line.line_item_id,
      message,
    }))
  )
  const lineWarnings = calculatedLines.flatMap((line) =>
    line.warnings.map((message) => ({
      line_item_id: line.line.line_item_id,
      message,
    }))
  )
  const totalsComplete =
    lineErrors.length === 0 &&
    calculatedLines.every(
      (line) =>
        line.final_line_subtotal !== null &&
        line.final_line_tax_total !== null &&
        line.final_line_total !== null &&
        line.delta_line_total !== null
    )

  const finalItemTotal = totalsComplete
    ? roundMoney(
        calculatedLines.reduce(
          (sum, line) => sum + numberOrZero(line.final_line_subtotal),
          0
        )
      )
    : null
  const recalculatedLineTax = totalsComplete
    ? roundMoney(
        calculatedLines.reduce(
          (sum, line) => sum + numberOrZero(line.final_line_tax_total),
          0
        )
      )
    : null
  const estimatedLineTax = roundMoney(
    detail.lines.reduce(
      (sum: number, line: Record<string, any>) =>
        sum + numberOrZero(metadataObject(line.metadata).estimated_tax_total),
      0
    )
  )
  const fixedNonLineTax = totalsComplete
    ? Math.max(0, roundMoney(breakdown.estimated_tax_total - estimatedLineTax))
    : null
  const finalTaxTotal = totalsComplete
    ? roundMoney(numberOrZero(recalculatedLineTax) + numberOrZero(fixedNonLineTax))
    : null
  const finalShippingTotal = totalsComplete
    ? breakdown.estimated_shipping_total
    : null
  const finalDiscountTotal = totalsComplete
    ? breakdown.estimated_discount_total
    : null
  const finalOrderTotal = totalsComplete
    ? roundMoney(
        numberOrZero(finalItemTotal) +
          numberOrZero(finalShippingTotal) +
          numberOrZero(finalTaxTotal) -
          numberOrZero(finalDiscountTotal)
      )
    : null
  const deltaTotal =
    finalOrderTotal !== null
      ? roundMoney(finalOrderTotal - breakdown.estimated_order_total)
      : null
  const summary = {
    final_item_total: finalItemTotal,
    final_shipping_total: finalShippingTotal,
    final_tax_total: finalTaxTotal,
    final_discount_total: finalDiscountTotal,
    final_order_total: finalOrderTotal,
    delta_total: deltaTotal,
  }

  if (options.persist) {
    await Promise.all(
      calculatedLines.map((calculated) =>
        db("gp_order_finalization_line")
          .where({ id: calculated.line.id })
          .update({
            final_line_subtotal: calculated.final_line_subtotal,
            final_line_total: calculated.final_line_total,
            delta_line_total: calculated.delta_line_total,
            status: calculated.errors.length
              ? calculated.line.status
              : calculated.line.status === "needs_weight"
                ? "ready"
                : calculated.line.status,
            updated_at: new Date(),
          })
      )
    )
    await db("gp_order_finalization")
      .where({ id: detail.finalization.id })
      .update({
        ...summary,
        status: lineErrors.length
          ? FINALIZATION_PACKED_PENDING_REVIEW
          : FINALIZATION_PACKED_PENDING_CHARGE,
        reviewed_at: new Date(),
        updated_at: new Date(),
      })
  }

  return {
    finalization: {
      ...detail.finalization,
      ...summary,
    },
    lines: calculatedLines.map((calculated) => ({
      ...calculated.line,
      final_line_subtotal: calculated.final_line_subtotal,
      final_line_tax_total: calculated.final_line_tax_total,
      final_line_total: calculated.final_line_total,
      delta_line_total: calculated.delta_line_total,
      errors: calculated.errors,
      warnings: calculated.warnings,
    })),
    payment_setup: detail.payment_setup,
    charge_attempts: detail.charge_attempts,
    errors: lineErrors,
    warnings: lineWarnings,
    totals: summary,
  }
}

export async function approveFinalization(
  db: CatchWeightDb,
  order: Record<string, any>,
  actorId?: string | null
) {
  const preview = await previewFinalization(db, order, { persist: true })

  if (preview.errors.length) {
    throw new Error("Finalization cannot be approved until all line errors are fixed.")
  }

  await db("gp_order_finalization")
    .where({ id: preview.finalization.id })
    .update({
      status: FINALIZATION_PACKED_PENDING_CHARGE,
      reviewed_at: new Date(),
      reviewed_by: actorId || null,
      updated_at: new Date(),
    })

  return {
    ...preview,
    finalization: {
      ...preview.finalization,
      status: FINALIZATION_PACKED_PENDING_CHARGE,
      reviewed_by: actorId || null,
    },
  }
}

export async function nextChargeAttemptNumber(
  db: CatchWeightDb,
  orderId: string
) {
  const latest = await db("gp_final_charge_attempt")
    .where({ order_id: orderId })
    .whereNull("deleted_at")
    .orderBy("attempt_number", "desc")
    .first()

  return numberOrZero(latest?.attempt_number) + 1 || 1
}

export async function createStripeFinalPaymentIntent(input: {
  amount: number
  currencyCode: string
  stripeCustomerId?: string | null
  stripePaymentMethodId: string
  idempotencyKey: string
  orderId: string
  finalizationId: string
  displayId?: string | null
}): Promise<StripePaymentIntent> {
  const apiKey = process.env.STRIPE_API_KEY
  if (!apiKey) {
    throw new Error("Stripe secret key is not configured.")
  }

  const body = new URLSearchParams({
    amount: String(amountInMinorUnits(input.amount, input.currencyCode)),
    currency: input.currencyCode.toLowerCase(),
    payment_method: input.stripePaymentMethodId,
    confirm: "true",
    off_session: "true",
    capture_method: "automatic",
    description: `Griller's Pride order ${
      input.displayId ? `#${input.displayId}` : input.orderId
    }`,
    "metadata[payment_workflow]": PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
    "metadata[order_id]": input.orderId,
    "metadata[finalization_id]": input.finalizationId,
  })

  if (input.stripeCustomerId) {
    body.set("customer", input.stripeCustomerId)
  }

  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body,
  })
  const json = await response.json()

  if (!response.ok) {
    const error = new Error(
      json?.error?.message || "Stripe final charge failed."
    ) as Error & { stripe_error?: Record<string, any> }
    error.stripe_error = json?.error
    throw error
  }

  return json as StripePaymentIntent
}

export async function recordFinalChargeAttempt(
  db: CatchWeightDb,
  input: {
    orderId: string
    finalizationId: string
    amount: number
    currencyCode: string
    stripeCustomerId?: string | null
    stripePaymentMethodId: string
    stripePaymentIntentId?: string | null
    stripeChargeId?: string | null
    stripeStatus?: string | null
    status: "pending" | "succeeded" | "failed"
    failureCode?: string | null
    failureMessage?: string | null
    idempotencyKey: string
    requestedBy?: string | null
  }
) {
  const attemptNumber = await nextChargeAttemptNumber(db, input.orderId)
  const row = {
    id: id("gpcharge"),
    order_id: input.orderId,
    finalization_id: input.finalizationId,
    attempt_number: attemptNumber,
    amount: input.amount,
    currency_code: input.currencyCode,
    stripe_customer_id: input.stripeCustomerId || null,
    stripe_payment_method_id: input.stripePaymentMethodId,
    stripe_payment_intent_id: input.stripePaymentIntentId || null,
    stripe_charge_id: input.stripeChargeId || null,
    status: input.status,
    stripe_status: input.stripeStatus || null,
    failure_code: input.failureCode || null,
    failure_message: input.failureMessage || null,
    idempotency_key: input.idempotencyKey,
    requested_by: input.requestedBy || null,
    requested_at: new Date(),
    succeeded_at: input.status === "succeeded" ? new Date() : null,
    created_at: new Date(),
    updated_at: new Date(),
  }

  await db("gp_final_charge_attempt").insert(row)
  return row
}

export function finalChargeOrderMetadata(input: {
  order: Record<string, any>
  finalization: Record<string, any>
  paymentIntent: StripePaymentIntent
  attemptId: string
  actorId?: string | null
}) {
  const metadata = metadataObject(input.order.metadata)
  const chargeId =
    input.paymentIntent.latest_charge ||
    input.paymentIntent.charges?.data?.[0]?.id ||
    null
  const amountMinor = amountInMinorUnits(
    input.finalization.final_order_total,
    input.finalization.currency_code
  )
  const requestKey = `final_charge:${input.paymentIntent.id}`

  return appendStaffAudit(
    {
      ...metadata,
      payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
      catch_weight_status: FINALIZATION_CHARGED_READY_TO_SHIP,
      finalization_id: input.finalization.id,
      finalization_status: FINALIZATION_CHARGED_READY_TO_SHIP,
      estimated_total: input.finalization.estimated_order_total,
      final_total: input.finalization.final_order_total,
      catch_weight_delta: input.finalization.delta_total,
      stripe_payment_intent_id: input.paymentIntent.id,
      stripe_charge_id: chargeId,
      final_charge_status: "succeeded",
      fulfillment_gate_status: "released",
      qbd_posting_required: true,
      qbd_posting_status: "pending_manual",
      qbd_posting_action: "final_card_charge_accounting_record",
      qbd_posting_amount: amountMinor,
      qbd_posting_request_key: requestKey,
      qbd_posting_requested_at: new Date().toISOString(),
    },
    {
      action: "final_charge_succeeded",
      status: "released_to_fulfillment",
      amount: input.finalization.final_order_total,
      amount_minor: amountMinor,
      stripe_payment_intent_id: input.paymentIntent.id,
      stripe_charge_id: chargeId,
      charge_attempt_id: input.attemptId,
      staff_actor_id: input.actorId || null,
    }
  )
}
