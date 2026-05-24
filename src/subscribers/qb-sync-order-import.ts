import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

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
  "*shipping_address",
  "*billing_address",
  "items.*",
  "items.detail.*",
  "items.variant.*",
  "items.variant.product.*",
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

function hasPositiveValue(value: unknown): boolean {
  const parsed = numeric(value)
  return parsed !== null && parsed > 0
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
        const quantity = firstNumeric(item.quantity, detail.quantity) ?? 1
        const computedLineTotal =
          firstNumeric(item.unit_price, item.raw_unit_price) !== null
            ? (firstNumeric(item.unit_price, item.raw_unit_price) as number) *
              quantity
            : null
        const total = hasPositiveValue(item.total)
          ? numeric(item.total)
          : computedLineTotal ?? numeric(item.total)
        const subtotal = hasPositiveValue(item.subtotal)
          ? numeric(item.subtotal)
          : computedLineTotal ?? numeric(item.subtotal)

        return {
          ...item,
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

  const shippingTotal = numeric(order.shipping_total) ?? 0
  const taxTotal = numeric(order.tax_total) ?? 0
  const discountTotal = numeric(order.discount_total) ?? 0
  const computedOrderTotal =
    itemTotal !== null ? itemTotal + shippingTotal + taxTotal - discountTotal : null
  const total = hasPositiveValue(order.total)
    ? numeric(order.total)
    : computedOrderTotal ?? numeric(order.total)
  const subtotal = hasPositiveValue(order.subtotal)
    ? numeric(order.subtotal)
    : itemTotal ?? numeric(order.subtotal)

  return {
    ...order,
    items,
    subtotal,
    total,
  }
}

export async function postOrderToQbSync(
  endpoint: string,
  token: string,
  order: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS)

  try {
    return await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-QB-Sync-Token": token,
      },
      body: JSON.stringify({ order }),
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
