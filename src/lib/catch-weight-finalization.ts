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

const fieldAmount = (source: Record<string, any>, names: string[]) => {
  for (const name of names) {
    const value = nullableNumber(source?.[name])
    if (value !== null) return value
  }
  return 0
}

const lower = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : ""

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
  return parseWeight(value)
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
  const quantity = fieldAmount(item, ["quantity", "raw_quantity"])
  const unitPrice = fieldAmount(item, ["unit_price", "raw_unit_price"])
  const subtotal =
    fieldAmount(item, ["subtotal", "raw_subtotal"]) ||
    roundMoney(unitPrice * quantity)
  const total = fieldAmount(item, ["total", "raw_total"]) || subtotal
  const tax = fieldAmount(item, ["tax_total", "raw_tax_total"])

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
    customer_title: item.title || item.product_title || null,
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
  const newLines = (order.items || [])
    .filter((item: Record<string, any>) => item?.id && !existingLineIds.has(item.id))
    .map((item: Record<string, any>) =>
      buildFinalizationLineSnapshot(order, item, finalization.id)
    )

  if (newLines.length) {
    await db("gp_order_finalization_line").insert(newLines)
  }

  const lines = [...(existingLines || []), ...newLines]
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

  let finalSubtotal: number | null = nullableNumber(line.final_line_subtotal)
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
  } else if (pricingMode === "per_lb") {
    if (!actualWeightTotal || actualWeightTotal <= 0) {
      errors.push("Actual weight is required for per-lb items.")
    } else {
      finalSubtotal = roundMoney(actualWeightTotal * unitPrice)
    }
  } else if (finalSubtotal === null) {
    finalSubtotal = roundMoney(actualQuantity * unitPrice)
  }

  if (status !== "removed" && unitPrice <= 0) {
    errors.push("Final unit price is missing.")
  }

  const finalTax = roundMoney((finalSubtotal || 0) * estimatedTaxRate)
  const finalTotal = roundMoney((finalSubtotal || 0) + finalTax)
  const delta = roundMoney(finalTotal - estimatedTotal)

  if (Math.abs(delta) >= Math.max(15, estimatedTotal * 0.25)) {
    warnings.push("Large final price change needs staff review.")
  }

  return {
    line,
    final_line_subtotal: finalSubtotal || 0,
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

  const finalItemTotal = roundMoney(
    calculatedLines.reduce((sum, line) => sum + line.final_line_subtotal, 0)
  )
  const recalculatedLineTax = roundMoney(
    calculatedLines.reduce((sum, line) => sum + line.final_line_tax_total, 0)
  )
  const estimatedLineTax = roundMoney(
    detail.lines.reduce(
      (sum: number, line: Record<string, any>) =>
        sum + numberOrZero(metadataObject(line.metadata).estimated_tax_total),
      0
    )
  )
  const fixedNonLineTax = Math.max(
    0,
    roundMoney(breakdown.estimated_tax_total - estimatedLineTax)
  )
  const finalTaxTotal = roundMoney(recalculatedLineTax + fixedNonLineTax)
  const finalShippingTotal = breakdown.estimated_shipping_total
  const finalDiscountTotal = breakdown.estimated_discount_total
  const finalOrderTotal = roundMoney(
    finalItemTotal +
      finalShippingTotal +
      finalTaxTotal -
      finalDiscountTotal
  )
  const deltaTotal = roundMoney(
    finalOrderTotal - breakdown.estimated_order_total
  )
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
