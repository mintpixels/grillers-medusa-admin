import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { createHmac } from "node:crypto"

export const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "updated_at",
  "customer_id",
  "status",
  "fulfillment_status",
  "payment_status",
  "metadata",
  "total",
  "subtotal",
  "item_total",
  "item_subtotal",
  "tax_total",
  "shipping_total",
  "discount_total",
  "shipping_subtotal",
  "shipping_tax_total",
  "shipping_address.*",
  "billing_address.*",
  "items.*",
  "+items.metadata",
  "items.detail.*",
  "items.variant.*",
  "+items.variant.metadata",
  "items.variant.product.*",
  "+items.variant.product.metadata",
  "shipping_methods.*",
  "payment_collections.id",
  "payment_collections.status",
  "payment_collections.payments.id",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.amount",
  "payment_collections.payments.currency_code",
]

const IMPORT_TIMEOUT_MS = 15_000
function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    (typeof value.value === "number" || typeof value.value === "string")
  ) {
    return numeric(value.value)
  }

  return null
}

function firstNumeric(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== null) {
      return parsed
    }
  }

  return null
}

function firstPositiveNumeric(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== null && parsed > 0) {
      return parsed
    }
  }

  return null
}

const QBD_LIST_ID_KEYS = [
  "qbd_list_id",
  "qbdListId",
  "QbdListId",
  "quickbooks_list_id",
  "quickbooksListId",
  "QuickBooksListId",
  "qb_list_id",
  "qbListId",
  "QbListId",
  "qbd_item_list_id",
  "qbdItemListId",
  "QbdItemListId",
  "quickbooks_item_list_id",
  "quickbooksItemListId",
  "QuickBooksItemListId",
  "qb_item_list_id",
  "qbItemListId",
  "QbItemListId",
  "qbd_item_id",
  "qbdItemId",
  "QbdItemId",
  "quickbooks_item_id",
  "quickbooksItemId",
  "QuickBooksItemId",
  "qb_item_id",
  "qbItemId",
  "QbItemId",
]

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim()
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

function metadataListId(metadata: unknown): string | null {
  const record = objectRecord(metadata)
  for (const key of QBD_LIST_ID_KEYS) {
    const value = textValue(record[key])
    if (value) {
      return value
    }
  }

  for (const namespace of ["qbd", "quickbooks", "qb"]) {
    const nested = objectRecord(record[namespace])
    const value =
      textValue(nested.list_id) ||
      textValue(nested.item_list_id) ||
      textValue(nested.item_id)
    if (value) {
      return value
    }
  }

  return null
}

function itemQbdListId(item: Record<string, unknown>): string | null {
  const variant = objectRecord(item.variant)
  const product = objectRecord(item.product)
  const variantProduct = objectRecord(variant.product)

  return (
    metadataListId(item.metadata) ||
    metadataListId(variant.metadata) ||
    metadataListId(product.metadata) ||
    metadataListId(variantProduct.metadata)
  )
}

export function normalizeOrderForQbSync(
  order: Record<string, unknown>
): Record<string, unknown> {
  const items = Array.isArray(order.items)
    ? order.items.map((rawItem) => {
        if (!rawItem || typeof rawItem !== "object") {
          return rawItem
        }

        const item = rawItem as Record<string, unknown>
        const detail =
          item.detail && typeof item.detail === "object"
            ? (item.detail as Record<string, unknown>)
            : {}
        const metadata = objectRecord(item.metadata)
        const qbdListId = itemQbdListId(item)
        const quantity =
          firstNumeric(
            item.raw_quantity,
            detail.raw_quantity,
            detail.quantity,
            item.quantity
          ) ?? 1
        const unitPrice = firstNumeric(item.unit_price, item.raw_unit_price)
        const computedLineSubtotal =
          unitPrice !== null ? unitPrice * quantity : null
        const subtotal =
          firstPositiveNumeric(
            item.raw_subtotal,
            item.subtotal,
            item.original_subtotal
          ) ??
          computedLineSubtotal ??
          0
        const total =
          firstPositiveNumeric(
            item.raw_total,
            item.total,
            item.original_total
          ) ??
          (computedLineSubtotal !== null
            ? computedLineSubtotal + (numeric(item.tax_total) ?? 0)
            : null) ??
          subtotal

        return {
          ...item,
          metadata: qbdListId
            ? {
                ...metadata,
                qbd_list_id: qbdListId,
              }
            : item.metadata,
          quantity,
          subtotal,
          total,
        }
      })
    : order.items

  const itemTotal = Array.isArray(items)
    ? items.reduce((sum, item) => {
        if (!item || typeof item !== "object") return sum
        return sum + (numeric((item as Record<string, unknown>).total) ?? 0)
      }, 0)
    : null
  const itemSubtotal = Array.isArray(items)
    ? items.reduce((sum, item) => {
        if (!item || typeof item !== "object") return sum
        return sum + (numeric((item as Record<string, unknown>).subtotal) ?? 0)
      }, 0)
    : null

  const shippingTotal = numeric(order.shipping_total) ?? 0
  const taxTotal = numeric(order.tax_total) ?? 0
  const discountTotal = numeric(order.discount_total) ?? 0
  const grossItemTotal =
    firstPositiveNumeric(order.item_total) ??
    (itemTotal !== null && itemTotal > 0 ? itemTotal : null)
  const computedOrderTotal =
    grossItemTotal !== null
      ? grossItemTotal + shippingTotal - discountTotal
      : null
  const total =
    computedOrderTotal !== null && computedOrderTotal > 0
      ? computedOrderTotal
      : firstNumeric(order.total, itemTotal, taxTotal)
  const subtotal =
    firstPositiveNumeric(order.item_subtotal, order.subtotal) ??
    (itemSubtotal !== null && itemSubtotal > 0 ? itemSubtotal : null) ??
    (itemTotal !== null && itemTotal > 0 ? itemTotal : null) ??
    numeric(order.subtotal)

  return {
    ...order,
    items,
    subtotal,
    total,
  }
}

export function buildQbSyncSignature(
  body: string,
  timestamp: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
}

export async function postOrderToQbSync(
  endpoint: string,
  token: string,
  order: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  signingSecret = process.env.QB_SYNC_ORDER_IMPORT_SIGNING_SECRET || token
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS)
  const body = JSON.stringify({ order })
  const timestamp = String(Date.now())
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-QB-Sync-Token": token,
  }

  if (signingSecret) {
    headers["X-QB-Sync-Timestamp"] = timestamp
    headers["X-QB-Sync-Signature"] = buildQbSyncSignature(
      body,
      timestamp,
      signingSecret
    )
  }

  try {
    return await fetchFn(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

export default async function qbSyncOrderImportHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const endpoint = process.env.QB_SYNC_ORDER_IMPORT_URL
  const token = process.env.QB_SYNC_ORDER_IMPORT_TOKEN

  if (!endpoint || !token) {
    logger.warn(
      `[qb-sync-order-import] QB_SYNC_ORDER_IMPORT_URL or QB_SYNC_ORDER_IMPORT_TOKEN missing; skipped order=${data.id}`
    )
    return
  }

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: { id: data.id },
    })

    const order = orders?.[0] as Record<string, unknown> | undefined
    if (!order) {
      logger.warn(`[qb-sync-order-import] order not found id=${data.id}`)
      return
    }

    const response = await postOrderToQbSync(
      endpoint,
      token,
      normalizeOrderForQbSync(order)
    )

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      logger.error(
        `[qb-sync-order-import] import failed order=${data.id} status=${response.status} body=${body.slice(0, 500)}`
      )
      return
    }

    logger.info(`[qb-sync-order-import] imported order=${data.id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[qb-sync-order-import] failed for order ${data.id}: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
