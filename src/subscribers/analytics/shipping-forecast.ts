import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  estimatePackagingCost,
  packagingConfigFromEnv,
} from "../../lib/packaging-cost"
import { shippingForecastInputFromFulfillmentData } from "../../lib/shipping-cost-forecast"
import {
  isUpsServiceCode,
  normalizeGrillersUpsServiceCode,
} from "../../modules/fulfillment/wwex-speedship"

/**
 * Emits a `shipping_forecast` analytics event once per completed order so the
 * shipping charge can be dashboarded against its cost over time.
 *
 * For every UPS-shipped order it decomposes the charged shipping total into its
 * two known components — the freight forecast and the additive packaging cost
 * (dry ice + shipper box, Peter 2026-06-16, gated ON in prod via
 * GRILLERS_SHIPPING_FORECAST_INCLUDE_PACKAGING). The freight component is
 * recovered as `charged_shipping - packaging_cost`, mirroring how the
 * fulfillment provider builds the charge (`charge = freight + packaging`).
 *
 * Joined later to the Unishippers actuals, the warehouse stream answers
 * charged-vs-freight-vs-packaging today and charge-vs-actual-cost drift once
 * the actual carrier invoice lands.
 *
 * Pickup / local-delivery / flat orders carry no UPS service code and are
 * skipped — there is no freight to forecast or reconcile for them.
 *
 * Fire-and-forget: never throws (a failure here must not break order placement).
 */

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

function metadataObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, any>
      }
    } catch {
      return {}
    }
  }
  return {}
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

function envFlag(
  env: Record<string, string | undefined>,
  key: string,
  fallback = false
): boolean {
  const value = env[key]
  if (value == null || value === "") return fallback
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase())
}

function latestShippingMethod(order: Record<string, any>): Record<string, any> {
  const methods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : []
  return methods[methods.length - 1] || {}
}

/**
 * Resolve the UPS service code of the chosen shipping method, mirroring how the
 * fulfillment provider derives it. Returns "" when the method is not a UPS
 * calculated rate (pickup / local-delivery / flat) so the caller can skip.
 */
function upsServiceCodeForMethod(method: Record<string, any>): string {
  const methodData = metadataObject(method.data)
  const methodMetadata = metadataObject(method.metadata)
  const candidate = firstText(
    methodData.service_code,
    methodMetadata.service_code,
    method.shipping_option_id,
    method.name
  )
  const normalized = normalizeGrillersUpsServiceCode(candidate)
  return isUpsServiceCode(normalized) ? normalized : ""
}

function sourceForAnalytics(metadata: Record<string, any>): "staff" | "web" {
  if (STAFF_SOURCES.has(firstText(metadata.source))) return "staff"
  if (metadata.staff_phone_order === true) return "staff"
  return "web"
}

function customerTypeForAnalytics(
  order: Record<string, any>,
  metadata: Record<string, any>
): "dtc" | "institutional" {
  const groups = Array.isArray(order.customer?.groups)
    ? order.customer.groups
    : []
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
  return "dtc"
}

function routeMarketForAnalytics(
  order: Record<string, any>,
  metadata: Record<string, any>
): "atlanta_metro" | "southeast" | "national" | "unknown" {
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
  )
    .toUpperCase()
    .replace(/^US[-\s]+/, "")

  if (zip && ATLANTA_DELIVERY_ZIPS.has(zip)) return "atlanta_metro"
  if (state && IN_REGION_STATES.has(state)) return "southeast"
  if (state || zip) return "national"
  return "unknown"
}

/**
 * Builds the `shipping_forecast` analytics payload for an order, or returns null
 * when the order is not a UPS-shipped order. Pure + side-effect-free so it can be
 * unit-tested without the Medusa container.
 */
export function buildShippingForecastEvent(
  order: Record<string, any>,
  env: Record<string, string | undefined> = process.env
): {
  event: "shipping_forecast"
  actor_id?: string
  properties: Record<string, any>
} | null {
  const method = latestShippingMethod(order)
  const service = upsServiceCodeForMethod(method)
  // Skip pickup / local-delivery / flat: no UPS freight to forecast or reconcile.
  if (!service) return null

  const metadata = metadataObject(order.metadata)
  const shippingAddress = metadataObject(order.shipping_address)

  // Derive the SAME estimated product weight + ship state the forecast charge
  // used, by reusing the shared fulfillment-input helper (single source of truth
  // for the per-item AvgPackWeight-style weight math).
  const forecastInput = shippingForecastInputFromFulfillmentData(service, {
    items: order.items,
    shipping_address: shippingAddress,
    service_code: service,
  })
  const estimatedWeightLb = forecastInput?.estimated_product_weight_lb ?? 0
  const shipPostalCode =
    forecastInput?.ship_postal_code ||
    firstText(shippingAddress.postal_code, shippingAddress.zip)
  const shipState =
    forecastInput?.ship_state ||
    firstText(
      shippingAddress.province_code,
      shippingAddress.province,
      shippingAddress.state
    ).toUpperCase()

  const pkg = estimatePackagingCost(
    {
      estimatedProductWeightLb: estimatedWeightLb,
      service,
      shipPostalCode,
    },
    packagingConfigFromEnv(env)
  )

  // Charged shipping = what the customer actually paid for shipping. Prefer the
  // chosen method's amount, fall back to the order's shipping_total.
  const chargedShipping = roundMoney(
    numberValue(method.amount) ?? numberValue(order.shipping_total) ?? 0
  )

  // The charge is built as `freight + packaging` (packaging gated ON in prod).
  // Recover the freight component by subtracting the packaging estimate. When
  // packaging is gated OFF, charged == freight and packaging_cost is 0.
  const packagingIncludedInCharge = envFlag(
    env,
    "GRILLERS_SHIPPING_FORECAST_INCLUDE_PACKAGING",
    false
  )
  const packagingCost = packagingIncludedInCharge ? pkg.total : 0
  const freight = roundMoney(chargedShipping - packagingCost)

  const customerId = order.customer_id || undefined
  const orderId = order.id
  const idempotencyKey = `order.placed:${orderId}:shipping_forecast`

  return {
    event: "shipping_forecast",
    actor_id: customerId,
    properties: {
      order_id: orderId,
      // mirror id used by the GP analytics shim for stable session/idempotency.
      transaction_id: orderId,
      order_display_id: order.display_id,
      // Deterministic occurred-at so shim timestamps survive replays.
      order_created_at: order.created_at,
      customer_id: customerId,
      email: order.email,
      ship_state: shipState,
      dest_postal_code: shipPostalCode,
      service,
      transit_days: pkg.transitDays,
      estimated_weight_lb: roundMoney(estimatedWeightLb),
      boxes: pkg.boxes,
      box_tier: pkg.boxTier,
      dry_ice_lb: pkg.dryIceLb,
      box_cost: pkg.boxCost,
      dry_ice_cost: pkg.dryIceCost,
      packaging_cost: packagingCost,
      charged_shipping: chargedShipping,
      freight,
      packaging_included_in_charge: packagingIncludedInCharge,
      source: sourceForAnalytics(metadata),
      customer_type: customerTypeForAnalytics(order, metadata),
      route_market: routeMarketForAnalytics(order, metadata),
      fulfillment_tier: `ups_${service.toLowerCase()}`,
      medusa_event_id: idempotencyKey,
      idempotency_key: idempotencyKey,
    },
  }
}

export default async function shippingForecastHandler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
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
        "created_at",
        "email",
        "currency_code",
        "customer_id",
        "customer.*",
        "customer.groups.*",
        "+customer.metadata",
        "+customer.groups.metadata",
        "shipping_total",
        "+metadata",
        "shipping_address.*",
        "items.*",
        "+items.metadata",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_methods.*",
        "shipping_methods.shipping_option_id",
        "+shipping_methods.data",
        "+shipping_methods.metadata",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0] as any
    if (!order) return

    const payload = buildShippingForecastEvent(order, process.env)
    // Not a UPS order (pickup / local / flat): nothing to forecast or reconcile.
    if (!payload) return

    // Fire-and-forget: emit through the same gp-analytics shim every other
    // subscriber uses (server + GP dual-run). Source = medusa-fulfillment.
    await analyticsService.track({
      event: payload.event,
      actor_id: payload.actor_id,
      properties: {
        ...payload.properties,
        source: "medusa-fulfillment",
      },
    })
  } catch (err) {
    logger.warn(
      `Analytics: Failed to track shipping_forecast for ${orderId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  // Fire on every order at checkout (matches order-placed.ts). order.completed
  // fires later and not for every order, so it would undercount the dashboard.
  event: "order.placed",
}
