import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  generateEntityId,
} from "@medusajs/framework/utils"
import { buildLegacyReorderRequestEmail } from "../../../../lib/emails/templates/legacy-reorder-request"
import {
  listLegacyPurchaseHistoryForCustomer,
  normalizeEmail,
} from "../../../../lib/legacy-order-history"

type ReorderRequestBody = {
  key?: string
}

type PurchaseHistoryItem = {
  key?: string
  variantId?: string
  productId?: string
  legacyItemId?: string | null
  sku?: string | null
  title?: string | null
  productTitle?: string | null
  lastOrderedAt?: string | null
  timesOrdered?: number | null
  totalQuantity?: number | null
  unitPrice?: number | null
  currencyCode?: string | null
  reorderable?: boolean
  mappingStatus?: string | null
  lastOrderRef?: string | null
  orderCount?: number | null
}

const REQUEST_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

const normalizeText = (value: unknown): string | null => {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

const asNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

const asIsoOrNull = (value: unknown): string | null => {
  const text = normalizeText(value)
  if (!text) {
    return null
  }

  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

const requestRecipient = () =>
  process.env.LEGACY_REORDER_REQUEST_TO ||
  process.env.SUPPORT_EMAIL ||
  "peter@grillerspride.com"

async function loadCustomer(db: any, customerId: string) {
  return await db("customer")
    .select(["id", "email", "first_name", "last_name"])
    .where("id", customerId)
    .whereNull("deleted_at")
    .first()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const body = (req.body ?? {}) as ReorderRequestBody
  const key = normalizeText(body.key)
  if (!key) {
    res.status(400).json({ message: "Missing purchase history key" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = req.scope.resolve("logger")
  const purchaseHistory = (await listLegacyPurchaseHistoryForCustomer(
    db,
    customerId
  )) as PurchaseHistoryItem[]
  const item = purchaseHistory.find((historyItem) => historyItem.key === key)

  if (!item) {
    res.status(404).json({ message: "Purchase history item not found" })
    return
  }

  const dedupeAfter = new Date(Date.now() - REQUEST_DEDUPE_WINDOW_MS)
  const existing = await db("legacy_reorder_request")
    .select(["id", "request_status", "notification_status", "requested_at"])
    .where("medusa_customer_id", customerId)
    .where("legacy_history_key", key)
    .whereNull("deleted_at")
    .where("requested_at", ">=", dedupeAfter)
    .orderBy("requested_at", "desc")
    .first()

  if (existing) {
    res.json({
      ok: true,
      status: "already_requested",
      request_id: existing.id,
      notification_status: existing.notification_status,
    })
    return
  }

  const now = new Date()
  const requestId = generateEntityId(undefined, "lgrreq")
  const customer = await loadCustomer(db, customerId)
  const customerName = [customer?.first_name, customer?.last_name]
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(" ")
  const emailLower = normalizeEmail(customer?.email)
  const title =
    normalizeText(item.productTitle) ||
    normalizeText(item.title) ||
    "Past purchase"

  const row = {
    id: requestId,
    medusa_customer_id: customerId,
    email_lower: emailLower,
    customer_name: normalizeText(customerName),
    legacy_history_key: key,
    legacy_item_id: normalizeText(item.legacyItemId),
    sku: normalizeText(item.sku),
    title,
    product_title: normalizeText(item.productTitle),
    last_ordered_at: asIsoOrNull(item.lastOrderedAt),
    last_order_ref: normalizeText(item.lastOrderRef),
    times_ordered: asNumber(item.timesOrdered),
    order_count: asNumber(item.orderCount),
    total_quantity: asNumber(item.totalQuantity),
    unit_price: asNumber(item.unitPrice),
    currency_code: normalizeText(item.currencyCode) || "usd",
    request_status: "submitted",
    notification_status: "pending",
    requested_at: now,
    metadata: {
      source: "storefront_reorder",
      reorderable: Boolean(item.reorderable),
      mapping_status: item.mappingStatus || null,
      medusa_product_id: item.productId || null,
      medusa_variant_id: item.variantId || null,
    },
    created_at: now,
    updated_at: now,
  }

  await db("legacy_reorder_request").insert(row)

  try {
    const notificationModule = req.scope.resolve(Modules.NOTIFICATION)
    const { subject, html, text } = buildLegacyReorderRequestEmail({
      requestId,
      customerId,
      customerName: customerName || null,
      customerEmail: customer?.email || null,
      item: {
        key,
        title,
        productTitle: item.productTitle || null,
        legacyItemId: item.legacyItemId || null,
        sku: item.sku || null,
        lastOrderedAt: item.lastOrderedAt || null,
        lastOrderRef: item.lastOrderRef || null,
        timesOrdered: item.timesOrdered || 0,
        orderCount: item.orderCount || 0,
        totalQuantity: item.totalQuantity || 0,
        unitPrice: item.unitPrice || 0,
        currencyCode: item.currencyCode || "usd",
        mappingStatus: item.mappingStatus || null,
        productId: item.productId || null,
        variantId: item.variantId || null,
      },
    })

    await notificationModule.createNotifications({
      to: requestRecipient(),
      channel: "email",
      template: "legacy-reorder-request",
      content: { subject, html, text },
      data: {
        request_id: requestId,
        customer_id: customerId,
        customer_email: customer?.email || null,
        legacy_history_key: key,
        legacy_item_id: item.legacyItemId || null,
        sku: item.sku || null,
        title,
        last_order_ref: item.lastOrderRef || null,
      },
    })

    await db("legacy_reorder_request")
      .where("id", requestId)
      .update({
        notification_status: "sent",
        updated_at: new Date(),
      })

    res.json({
      ok: true,
      status: "submitted",
      request_id: requestId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[legacy-reorder-request] notification failed request=${requestId} customer=${customerId}: ${message}`
    )

    await db("legacy_reorder_request")
      .where("id", requestId)
      .update({
        request_status: "notification_failed",
        notification_status: "failed",
        notification_error: message,
        updated_at: new Date(),
      })

    res.status(500).json({
      ok: false,
      status: "notification_failed",
      request_id: requestId,
      message: "Could not notify staff. Please call the store.",
    })
  }
}
