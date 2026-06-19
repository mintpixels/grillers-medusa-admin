import { buildShippingForecastEvent } from "../../subscribers/analytics/shipping-forecast"
import { estimatePackagingCost, packagingConfigFromEnv } from "../packaging-cost"

// Packaging gated ON, matching prod (GRILLERS_SHIPPING_FORECAST_INCLUDE_PACKAGING).
const ENV_PACKAGING_ON = {
  GRILLERS_SHIPPING_FORECAST_INCLUDE_PACKAGING: "true",
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// A UPS-ground order to Pennsylvania (national) with ~12 lb of product across
// two fixed-price packs, charged $58 for shipping.
function upsGroundOrder() {
  return {
    id: "order_ups_1",
    display_id: 4242,
    email: "buyer@example.com",
    customer_id: "cus_ups_1",
    currency_code: "usd",
    shipping_total: 58,
    metadata: { source: "web", customer_type: "dtc" },
    shipping_address: {
      province_code: "us-pa",
      postal_code: "19103",
    },
    items: [
      {
        id: "li_1",
        quantity: 1,
        unit_price: 40,
        subtotal: 40,
        metadata: { pricing_mode: "fixed", avg_pack_weight_lb: 6 },
      },
      {
        id: "li_2",
        quantity: 1,
        unit_price: 35,
        subtotal: 35,
        metadata: { pricing_mode: "fixed", avg_pack_weight_lb: 6 },
      },
    ],
    shipping_methods: [
      {
        name: "UPS Ground Estimated Shipping",
        amount: 58,
        shipping_option_id: "so_ups_ground",
        data: { service_code: "GROUND" },
        metadata: {},
      },
    ],
  }
}

// A plant-pickup order — no UPS service code, should emit nothing.
function pickupOrder() {
  return {
    id: "order_pickup_1",
    display_id: 4243,
    email: "local@example.com",
    customer_id: "cus_pickup_1",
    currency_code: "usd",
    shipping_total: 0,
    metadata: { source: "web", customer_type: "dtc" },
    shipping_address: { province_code: "us-ga", postal_code: "30340" },
    items: [{ id: "li_p", quantity: 1, unit_price: 50, subtotal: 50, metadata: {} }],
    shipping_methods: [
      {
        name: "Plant Pickup",
        amount: 0,
        shipping_option_id: "so_plant_pickup",
        data: {},
        metadata: {},
      },
    ],
  }
}

describe("buildShippingForecastEvent", () => {
  it("emits a shipping_forecast event for a UPS order with freight = charged - packaging", () => {
    const order = upsGroundOrder()
    const payload = buildShippingForecastEvent(order, ENV_PACKAGING_ON)

    expect(payload).not.toBeNull()
    expect(payload!.event).toBe("shipping_forecast")
    expect(payload!.actor_id).toBe("cus_ups_1")

    const p = payload!.properties

    // Identity + routing
    expect(p.order_id).toBe("order_ups_1")
    expect(p.order_display_id).toBe(4242)
    expect(p.customer_id).toBe("cus_ups_1")
    expect(p.service).toBe("GROUND")
    expect(p.ship_state).toBe("PA")
    expect(p.dest_postal_code).toBe("19103")
    expect(p.route_market).toBe("national")
    expect(p.customer_type).toBe("dtc")
    expect(p.fulfillment_tier).toBe("ups_ground")

    // The estimated product weight is the sum of the per-item pack weights.
    expect(p.estimated_weight_lb).toBe(12)

    // Packaging matches the shared estimator exactly (same inputs + config).
    const pkg = estimatePackagingCost(
      {
        estimatedProductWeightLb: 12,
        service: "GROUND",
        shipPostalCode: "19103",
      },
      packagingConfigFromEnv(ENV_PACKAGING_ON)
    )
    expect(p.transit_days).toBe(pkg.transitDays)
    expect(p.boxes).toBe(pkg.boxes)
    expect(p.box_tier).toBe(pkg.boxTier)
    expect(p.dry_ice_lb).toBe(pkg.dryIceLb)
    expect(p.box_cost).toBe(pkg.boxCost)
    expect(p.dry_ice_cost).toBe(pkg.dryIceCost)
    expect(p.packaging_cost).toBe(pkg.total)

    // The load-bearing decomposition: charged = freight + packaging.
    expect(p.charged_shipping).toBe(58)
    expect(p.freight).toBe(round2(58 - pkg.total))
    expect(round2(p.freight + p.packaging_cost)).toBe(p.charged_shipping)
    expect(p.packaging_included_in_charge).toBe(true)
  })

  it("sets freight = charged_shipping and packaging_cost = 0 when packaging is gated OFF", () => {
    const order = upsGroundOrder()
    const payload = buildShippingForecastEvent(order, {})

    expect(payload).not.toBeNull()
    const p = payload!.properties
    expect(p.packaging_included_in_charge).toBe(false)
    expect(p.packaging_cost).toBe(0)
    expect(p.freight).toBe(58)
    expect(p.charged_shipping).toBe(58)
    // Packaging estimate is still reported for visibility even when not charged.
    expect(p.box_tier).toBeDefined()
    expect(p.boxes).toBeGreaterThanOrEqual(1)
  })

  it("emits nothing for a pickup order (no UPS service code)", () => {
    const payload = buildShippingForecastEvent(pickupOrder(), ENV_PACKAGING_ON)
    expect(payload).toBeNull()
  })
})
