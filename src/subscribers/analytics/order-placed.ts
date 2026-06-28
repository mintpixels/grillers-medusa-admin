import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"
import {
  experimentContextFromItem,
  experimentContextFromItems,
  experimentIdentityFromItems,
} from "../../lib/analytics/experiment-context"
import {
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  finalChargeSucceeded,
  metadataObject,
} from "../../lib/catch-weight-finalization"

const STAFF_SOURCES = new Set([
  "staff",
  "staff_phone_order",
  "staff_impersonation",
  "admin_staff_reorder",
])
const IN_REGION_STATES = new Set(["GA", "TN", "TX", "NC", "FL", "SC", "AL"])
const ATLANTA_DELIVERY_ZIPS = new Set([
  "30005",
  "30009",
  "30022",
  "30033",
  "30062",
  "30067",
  "30068",
  "30071",
  "30075",
  "30079",
  "30092",
  "30093",
  "30097",
  "30319",
  "30322",
  "30324",
  "30326",
  "30327",
  "30328",
  "30329",
  "30338",
  "30339",
  "30340",
  "30341",
  "30342",
  "30345",
  "30346",
  "30350",
  "30360",
])

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

function numberValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null
  const parsed =
    typeof value === "object" && value !== null && "value" in value
      ? Number((value as Record<string, unknown>).value)
      : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function normalizeZip(value: unknown): string {
  const match = firstText(value).match(/\d{5}/)
  return match?.[0] || ""
}

function normalizeRouteMarket(value: unknown): string | null {
  const text = firstText(value).toLowerCase()
  if (text === "atlanta_metro" || text === "southeast" || text === "national") {
    return text
  }
  if (text === "core") return "atlanta_metro"
  if (text === "scheduled_pod") return "southeast"
  return null
}

function sourceForAnalytics(metadata: Record<string, any>): "staff" | "web" {
  if (STAFF_SOURCES.has(firstText(metadata.source))) return "staff"
  if (metadata.staff_phone_order === true) return "staff"
  return "web"
}

function customerTypeForAnalytics(order: Record<string, any>, metadata: Record<string, any>) {
  const groups = Array.isArray(order.customer?.groups) ? order.customer.groups : []
  const institutional = groups.some((group: Record<string, any>) => {
    const groupMetadata = metadataObject(group?.metadata)
    return (
      firstText(group?.name).toLowerCase().includes("institutional") ||
      firstText(group?.id).toLowerCase().includes("institutional") ||
      firstText(groupMetadata.customer_type).toLowerCase() === "institutional" ||
      groupMetadata.institutional === true
    )
  })

  if (institutional) return "institutional"
  if (metadata.customer_type === "institutional") return "institutional"
  if (metadata.customer_type === "dtc") return "dtc"
  return "dtc"
}

function routeMarketForAnalytics(order: Record<string, any>, metadata: Record<string, any>) {
  const shippingAddress = metadataObject(order.shipping_address)
  const zip = normalizeZip(
    shippingAddress.postal_code ||
      metadata.fulfillmentZip ||
      metadata.fulfillment_zip ||
      metadata.shipping_zip
  )
  const state = firstText(
    shippingAddress.province,
    shippingAddress.province_code,
    metadata.fulfillmentState,
    metadata.fulfillment_state,
    metadata.shipping_state
  ).toUpperCase()

  if (zip && ATLANTA_DELIVERY_ZIPS.has(zip)) return "atlanta_metro"
  if (state && IN_REGION_STATES.has(state)) return "southeast"
  if (state || zip) return "national"

  return normalizeRouteMarket(metadata.route_market) || "unknown"
}

function latestShippingMethod(order: Record<string, any>) {
  const methods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : []
  return methods[methods.length - 1] || {}
}

/**
 * Robust order revenue for the warehouse stream.
 *
 * Medusa v2 exposes `total` as a COMPUTED field, and on real catch-weight orders
 * it can be 0 even when the order is genuinely worth hundreds of dollars
 * (verified on order_01KVHNQ2MNQ1P50DVB62D7F3CC / display 135: `total: 0` but
 * `subtotal: 332.73`, `shipping_total: 164.49`, `payment_collections[0].amount:
 * 332.73`). Emitting `estimated_value: order.total` there sends 0 — a silent
 * revenue-correctness bug.
 *
 * So: prefer a positive `total`; otherwise reconstruct it from the components
 * (item_total + shipping + tax - discount), which ARE populated correctly. Note
 * we use `item_total` (goods only), NOT `subtotal`: on real orders Medusa's
 * `subtotal` already bakes in shipping (order 135: subtotal 332.73 == item_total
 * + shipping_total) and is otherwise unreliable, so `subtotal + shipping` would
 * DOUBLE-COUNT shipping. The reconstruction is exact for normal orders
 * (item_total + shipping == total) and the best available proxy when the
 * computed total is broken (order 135 reconstructs to 332.73, its true value).
 */
function orderRevenue(order: Record<string, any>): number {
  const total = numberValue(order.total)
  if (total !== null && total > 0) return roundMoney(total)

  const itemTotal = numberValue(order.item_total) ?? 0
  const shipping = numberValue(order.shipping_total) ?? 0
  const tax = numberValue(order.tax_total) ?? 0
  const discount = numberValue(order.discount_total) ?? 0
  const reconstructed = itemTotal + shipping + tax - discount
  if (reconstructed > 0) return roundMoney(reconstructed)

  // Last resort: a non-negative computed total (0) beats NaN/undefined.
  return roundMoney(total ?? 0)
}

function normalizeFulfillmentTier(value: unknown): string | null {
  const text = firstText(value).toLowerCase().replace(/[\s-]+/g, "_")
  if (!text) return null

  if (text === "plant_pickup") return "plant_pickup"
  if (text === "atlanta_delivery" || text === "local_delivery") {
    return "atlanta_delivery"
  }
  if (text === "southeast_pickup" || text === "regional_pickup") {
    return "southeast_pickup"
  }
  if (text === "ups_ground" || text === "ground") return "ups_ground"
  if (
    text === "ups_3day" ||
    text === "ups_3_day_select" ||
    text === "3_day_select" ||
    text.includes("3_day")
  ) {
    return "ups_3day"
  }
  if (
    text === "ups_2da" ||
    text === "ups_2day" ||
    text === "ups_2_day" ||
    text === "ups_2nd_day_air" ||
    text === "2nd_day_air" ||
    text === "2_day_air" ||
    text.includes("2nd_day") ||
    text.includes("second_day")
  ) {
    return "ups_2da"
  }
  if (
    text === "ups_overnight" ||
    text === "overnight" ||
    text.includes("next_day")
  ) {
    return "ups_overnight"
  }
  if (text.includes("southeast") && text.includes("pickup")) {
    return "southeast_pickup"
  }
  if (text.includes("atlanta") && text.includes("delivery")) {
    return "atlanta_delivery"
  }
  if (text.includes("scheduled") && text.includes("delivery")) {
    return "southeast_pickup"
  }
  if (text.includes("pickup")) return "plant_pickup"
  if (text.includes("ground")) return "ups_ground"
  if (text.includes("3_day")) return "ups_3day"
  if (text.includes("2nd_day") || text.includes("second_day")) {
    return "ups_2da"
  }
  if (text.includes("overnight")) return "ups_overnight"

  return null
}

function fulfillmentTierForAnalytics(order: Record<string, any>, metadata: Record<string, any>) {
  const method = latestShippingMethod(order)
  const methodData = metadataObject(method.data)
  const methodMetadata = metadataObject(method.metadata)

  return (
    normalizeFulfillmentTier(metadata.fulfillment_tier) ||
    normalizeFulfillmentTier(metadata.fulfillmentType) ||
    normalizeFulfillmentTier(metadata.fulfillment_type) ||
    normalizeFulfillmentTier(methodData.fulfillment_tier) ||
    normalizeFulfillmentTier(methodData.fulfillmentType) ||
    normalizeFulfillmentTier(methodData.fulfillment_type) ||
    normalizeFulfillmentTier(methodData.service_code) ||
    normalizeFulfillmentTier(methodMetadata.fulfillment_tier) ||
    normalizeFulfillmentTier(methodMetadata.service_code) ||
    normalizeFulfillmentTier(method.shipping_option_id) ||
    normalizeFulfillmentTier(method.name) ||
    null
  )
}

function finalLinesByItemId(metadata: Record<string, any>) {
  const raw = metadata.catch_weight_final_lines
  let lines: any[] = []
  if (Array.isArray(raw)) {
    lines = raw
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      lines = Array.isArray(parsed) ? parsed : []
    } catch {
      lines = []
    }
  }

  return new Map(
    lines
      .filter((line) => line && typeof line === "object" && line.line_item_id)
      .map((line) => [String(line.line_item_id), line])
  )
}

function finalizedLinePayload(
  item: Record<string, any>,
  finalLine: Record<string, any> | undefined
) {
  const itemTotal = numberValue(item.total) || 0
  if (!finalLine) {
    return {
      line_item_id: item.id,
      variant_id: item.variant_id,
      estimated_total: itemTotal,
      final_total: itemTotal,
      delta: 0,
    }
  }

  const finalTotal = numberValue(finalLine.final_line_total)
  const delta = numberValue(finalLine.delta_line_total)
  const estimatedTotal =
    numberValue(finalLine.estimated_line_total) ??
    numberValue(finalLine.estimated_total) ??
    (finalTotal !== null && delta !== null
      ? roundMoney(finalTotal - delta)
      : itemTotal)

  return {
    line_item_id: item.id,
    variant_id: item.variant_id,
    estimated_total: estimatedTotal,
    final_total: finalTotal ?? itemTotal,
    delta:
      delta ??
      (finalTotal !== null ? roundMoney(finalTotal - estimatedTotal) : 0),
  }
}

function medusaEventId(
  sourceEvent: string,
  analyticsEvent: string,
  orderId: string,
  data: Record<string, any>
) {
  const finalizationId = firstText(data.finalization_id, data.payment_intent_id)
  const suffix = finalizationId ? `:${finalizationId}` : ""
  return `${sourceEvent}:${orderId}:${analyticsEvent}${suffix}`
}

export default async function orderPlacedHandler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string; amount?: number }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")
  const orderId = data.order_id || data.id

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "cart_id",
        "created_at",
        "email",
        "currency_code",
        "customer_id",
        "customer.*",
        "customer.groups.*",
        "customer.metadata",
        "customer.groups.metadata",
        "total",
        "subtotal",
        "item_total",
        "tax_total",
        "shipping_total",
        "discount_total",
        "metadata",
        "shipping_address.*",
        "items.*",
        "items.metadata",
        "items.variant.*",
        "items.variant.product.*",
        // `.product.*` expands scalar columns but NOT the JSON `metadata` column
        // in query.graph — it must be requested explicitly, or kosher_type /
        // cut_type / holiday_association / is_catch_weight read below come back
        // undefined. Sibling queries (catch-weight-finalization, qb-sync-order-
        // import, inventory-allocation) all request it explicitly.
        "items.variant.product.metadata",
        "shipping_methods.*",
        "shipping_methods.shipping_option_id",
        "shipping_methods.data",
        "shipping_methods.metadata",
        "payment_collections.payments.*",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0] as any
    if (!order) return
    const metadata = metadataObject(order.metadata)
    const source = sourceForAnalytics(metadata)
    const customerType = customerTypeForAnalytics(order, metadata)
    const routeMarket = routeMarketForAnalytics(order, metadata)
    const fulfillmentTier = fulfillmentTierForAnalytics(order, metadata)

    if (
      name === "order.placed" &&
      !finalChargeSucceeded(metadata)
    ) {
      await analyticsService.track({
        event: "order_received",
        actor_id: order.customer_id || undefined,
        properties: {
          transaction_id: order.id,
          cart_id: order.cart_id,
          display_id: order.display_id,
          order_created_at: order.created_at,
          estimated_value: orderRevenue(order),
          currency: order.currency_code,
          email: order.email,
          customer_id: order.customer_id || undefined,
          payment_workflow:
            metadata.payment_workflow || PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
          finalization_id: metadata.finalization_id,
          final_charge_status: metadata.final_charge_status || "not_started",
          source,
          customer_type: customerType,
          route_market: routeMarket,
          fulfillment_tier: fulfillmentTier || undefined,
          medusa_event_id: medusaEventId(
            name,
            "order_received",
            order.id,
            data
          ),
          idempotency_key: medusaEventId(
            name,
            "order_received",
            order.id,
            data
          ),
        },
      })
      return
    }

    const customerId = order.customer_id || undefined

    const coupon = (order as any).promotions?.[0]?.code
    const experimentContext = experimentContextFromItems(order.items)
    const experimentIdentity = experimentIdentityFromItems(order.items)
    const completedMedusaEventId = medusaEventId(
      name,
      "order_completed",
      order.id,
      data
    )

    await analyticsService.track({
      event: "order_completed",
      actor_id: customerId,
      properties: {
        ...experimentIdentity,
        transaction_id: order.id,
        display_id: (order as any).display_id,
        order_created_at: order.created_at,
        value:
          data.amount ||
          Number(metadata.final_total || metadata.final_order_total) ||
          orderRevenue(order),
        subtotal: order.subtotal,
        currency: order.currency_code,
        tax: order.tax_total,
        shipping: order.shipping_total,
        discount: order.discount_total,
        coupon,
        email: order.email,
        customer_id: customerId,
        experiment_context: experimentContext,
        // Use the LATEST shipping method (matches shipping-forecast.ts'
        // latestShippingMethod) so the analytics shipping_tier and the
        // shipping_forecast event agree on which method an order shipped under,
        // even on multi-shipment orders. The first method is not necessarily the
        // one fulfilled.
        shipping_tier: latestShippingMethod(order)?.name || undefined,
        payment_method:
          order.payment_collections?.[0]?.payments?.[0]?.provider_id,
        source,
        customer_type: customerType,
        route_market: routeMarket,
        fulfillment_tier: fulfillmentTier,
        medusa_event_id: completedMedusaEventId,
        idempotency_key: completedMedusaEventId,
        items: order.items?.map((item: any) => ({
          item_id: item.variant?.product_id || item.id,
          item_name: item.title,
          variant_id: item.variant_id,
          price: item.unit_price,
          quantity: item.quantity,
          kosher_type: item.variant?.product?.metadata?.kosher_type,
          cut_type: item.variant?.product?.metadata?.cut_type,
          holiday_association:
            item.variant?.product?.metadata?.holiday_association,
          is_catch_weight:
            item.variant?.product?.metadata?.is_catch_weight,
          experiment_context: experimentContextFromItem(item),
        })),
      },
    })

    if (name === "order.final_charge_succeeded") {
      const finalizedMedusaEventId = medusaEventId(
        name,
        "order_finalized",
        order.id,
        data
      )
      const finalLines = finalLinesByItemId(metadata)
      // order.total is computed and may be 0 on real catch-weight orders; use the
      // robust revenue so the estimated/delta baseline is never a phantom 0.
      const revenue = orderRevenue(order)

      await analyticsService.track({
        event: "order_finalized",
        actor_id: customerId,
        properties: {
          transaction_id: order.id,
          display_id: (order as any).display_id,
          order_created_at: order.created_at,
          estimated_total: revenue,
          final_total:
            data.amount ||
            Number(metadata.final_total || metadata.final_order_total) ||
            revenue,
          catch_weight_delta:
            Number(metadata.final_total || metadata.final_order_total || revenue) -
            Number(metadata.estimated_total || revenue),
          currency: order.currency_code,
          email: order.email,
          customer_id: customerId,
          source,
          customer_type: customerType,
          route_market: routeMarket,
          fulfillment_tier: fulfillmentTier,
          medusa_event_id: finalizedMedusaEventId,
          idempotency_key: finalizedMedusaEventId,
          lines: order.items?.map((item: any) =>
            finalizedLinePayload(item, finalLines.get(String(item.id)))
          ),
        },
      })
    }
  } catch (err) {
    logger.error(
      `Analytics: Failed to track ${name} for ${orderId}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: name,
      analyticsEvent:
        name === "order.final_charge_succeeded"
          ? "order_completed_or_finalized"
          : "order_received_or_completed",
      entityId: orderId,
      path: "src/subscribers/analytics/order-placed.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: ["order.placed", "order.final_charge_succeeded"],
}
