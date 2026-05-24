import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

const ORDER_FIELDS = [
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
  "tax_total",
  "shipping_total",
  "discount_total",
  "shipping_address.*",
  "billing_address.*",
  "items.id",
  "items.title",
  "items.quantity",
  "items.unit_price",
  "items.total",
  "items.variant_id",
  "items.product_id",
  "items.variant_sku",
  "items.product_title",
  "items.variant_title",
  "+items.metadata",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_methods.*",
  "payment_collections.*",
  "payment_collections.payments.*",
]

const IMPORT_TIMEOUT_MS = 15_000

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

    const response = await postOrderToQbSync(endpoint, token, order)

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
