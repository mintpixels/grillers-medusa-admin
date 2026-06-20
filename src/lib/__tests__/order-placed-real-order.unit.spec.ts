/**
 * Regression tests for the order.placed post-placement subscribers, built from a
 * SNAPSHOT OF A REAL PRODUCTION ORDER (order_01KVHNQ2MNQ1P50DVB62D7F3CC, display
 * 135) rather than hand-built mocks.
 *
 * The original suites for these subscribers passed because their mock order data
 * had a convenient shape (e.g. shipping_methods[0].data.service_code = "GROUND",
 * order.metadata = {…}). The real order differs in three load-bearing ways that
 * broke order.placed processing in prod (2026-06-20 04:48):
 *   - order.metadata is NULL (not an object)
 *   - shipping_methods[0].data = { externalId } and .metadata = null, so the UPS
 *     service code is ONLY derivable from method.name ("UPS Overnight Shipping")
 *   - bundle line metadata; variant.metadata only carries qbd_list_id
 *
 * The three prod failures and what these tests pin:
 *   1. `Failed to track order.placed`        — order-placed.ts query.graph used
 *      `+`-prefixed NESTED fields (`+items.metadata`, `+customer.metadata`,
 *      `+shipping_methods.data`). In query.graph (unlike the REST `fields=`
 *      param) a leading `+` on a DOTTED path becomes part of the relation key,
 *      so the query throws `Entity 'Order' does not have property '+items'`
 *      BEFORE analytics.track() is ever reached.
 *   2. `shipping_forecast: reading 'kind'`   — same query bug in
 *      shipping-forecast.ts; plus the service-code resolver first-won on the
 *      opaque shipping_option_id and skipped real UPS orders. (.kind is guarded
 *      in gbmFeatureValue for defense-in-depth.)
 *   3. `inventory-allocation: '+items'`      — same query bug in
 *      inventory-allocation.ts ORDER_ALLOCATION_FIELDS / fetchVariants. Inventory
 *      was never allocated on any order (oversell risk).
 */
import { toRemoteQuery } from "@medusajs/modules-sdk/dist/remote-query/to-remote-query"
import { buildShippingForecastEvent } from "../../subscribers/analytics/shipping-forecast"
import { evaluateGbm } from "../shipping-cost-forecast"
import realOrder from "./__fixtures__/order-135-real.json"

// The exact query.graph field arrays each subscriber/lib sends. Kept in sync with
// the source so a future re-introduction of a `+`-prefixed nested field is caught.
const ORDER_PLACED_FIELDS = [
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
  "tax_total",
  "shipping_total",
  "discount_total",
  "metadata",
  "shipping_address.*",
  "items.*",
  "items.metadata",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_methods.*",
  "shipping_methods.shipping_option_id",
  "shipping_methods.data",
  "shipping_methods.metadata",
  "payment_collections.payments.*",
]

const SHIPPING_FORECAST_FIELDS = [
  "id",
  "display_id",
  "created_at",
  "email",
  "currency_code",
  "customer_id",
  "customer.*",
  "customer.groups.*",
  "customer.metadata",
  "customer.groups.metadata",
  "shipping_total",
  "metadata",
  "shipping_address.*",
  "items.*",
  "items.metadata",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_methods.*",
  "shipping_methods.shipping_option_id",
  "shipping_methods.data",
  "shipping_methods.metadata",
]

const ORDER_ALLOCATION_FIELDS = [
  "id",
  "display_id",
  "email",
  "customer_id",
  "metadata",
  "items.*",
  "items.detail.*",
  "items.metadata",
  "items.variant.*",
  "items.variant.metadata",
  "items.variant.product.*",
  "items.variant.product.metadata",
  "items.variant.inventory_items.*",
  "items.variant.inventory_items.required_quantity",
  "items.variant.inventory_items.inventory.*",
  "items.variant.inventory_items.inventory.location_levels.*",
]

const FETCH_VARIANTS_FIELDS = [
  "id",
  "sku",
  "title",
  "product_id",
  "metadata",
  "manage_inventory",
  "allow_backorder",
  "+inventory_quantity",
  "product.*",
  "product.metadata",
  "inventory_items.*",
  "inventory_items.required_quantity",
  "inventory_items.inventory.*",
  "inventory_items.inventory.location_levels.*",
]

/**
 * A `+`-prefixed DOTTED field (e.g. "+items.metadata") is a query.graph bug: the
 * leading "+" ends up on the first path segment, producing a relation key like
 * "+items" that Medusa cannot resolve. A "+" on a TOP-LEVEL field (no dot, e.g.
 * "+inventory_quantity") is fine — it stays a leaf field marker.
 */
function plusPrefixedNestedFields(fields: string[]): string[] {
  return fields.filter((f) => f.startsWith("+") && f.includes("."))
}

/** Top-level relation keys query.graph would build (excludes the __fields list). */
function relationKeys(entity: string, fields: string[]): string[] {
  const q = toRemoteQuery({ entity, fields, filters: {} } as any, new Map())
  return Object.keys((q as any)[entity]).filter((k) => k !== "__fields")
}

describe("order.placed subscriber query fields (real-order regression)", () => {
  const cases: Array<[string, string, string[]]> = [
    ["order-placed.ts", "order", ORDER_PLACED_FIELDS],
    ["shipping-forecast.ts", "order", SHIPPING_FORECAST_FIELDS],
    ["inventory-allocation ORDER_ALLOCATION_FIELDS", "order", ORDER_ALLOCATION_FIELDS],
    ["inventory-allocation fetchVariants", "product_variant", FETCH_VARIANTS_FIELDS],
  ]

  it.each(cases)(
    "%s carries no `+`-prefixed nested fields",
    (_name, _entity, fields) => {
      expect(plusPrefixedNestedFields(fields)).toEqual([])
    }
  )

  it.each(cases)(
    "%s produces no `+`-prefixed relation key through query.graph's toRemoteQuery",
    (_name, entity, fields) => {
      const badKeys = relationKeys(entity, fields).filter((k) => k.startsWith("+"))
      expect(badKeys).toEqual([])
    }
  )

  it("proves the bug shape: a `+`-prefixed nested field WOULD build a broken `+items` relation key", () => {
    // This is the exact failure: `+items.metadata` → relation key "+items" →
    // "Entity 'Order' does not have property '+items'". Guards the diagnosis.
    const keys = relationKeys("order", ["id", "+items.metadata"])
    expect(keys).toContain("+items")
  })
})

describe("buildShippingForecastEvent on the REAL order", () => {
  const ENV_PACKAGING_ON = { GRILLERS_SHIPPING_FORECAST_INCLUDE_PACKAGING: "true" }

  it("does not throw and resolves OVERNIGHT from method.name when data/metadata lack a service_code", () => {
    // Real order: shipping_methods[0] = { name: "UPS Overnight Shipping",
    // amount: 164.49, data: { externalId }, metadata: null }. The resolver must
    // fall through to method.name (NOT first-win on the opaque shipping_option_id).
    const method = realOrder.shipping_methods[0]
    expect(method.data).not.toHaveProperty("service_code")
    expect(method.metadata).toBeNull()

    let payload: ReturnType<typeof buildShippingForecastEvent>
    expect(() => {
      payload = buildShippingForecastEvent(realOrder as any, ENV_PACKAGING_ON)
    }).not.toThrow()

    expect(payload!).not.toBeNull()
    const p = payload!.properties
    expect(p.service).toBe("OVERNIGHT")
    expect(p.fulfillment_tier).toBe("ups_overnight")
    expect(p.ship_state).toBe("MA")
    expect(p.dest_postal_code).toBe("02453")
    expect(p.route_market).toBe("national")
    // charged == method.amount, decomposed into freight + packaging
    expect(p.charged_shipping).toBe(164.49)
    expect(p.packaging_cost).toBeGreaterThan(0)
    expect(Math.round((p.freight + p.packaging_cost) * 100) / 100).toBe(
      p.charged_shipping
    )
    expect(p.packaging_included_in_charge).toBe(true)
  })

  it("regression: an opaque shipping_option_id must NOT shadow a UPS method.name", () => {
    // Reproduces the skip bug directly: with no service_code anywhere and a
    // non-UPS option id, the human-readable UPS name must still win.
    const order = {
      ...(realOrder as any),
      shipping_methods: [
        {
          name: "UPS Ground Estimated Shipping",
          amount: 42,
          shipping_option_id: "so_01ABCNOTAUPSCODE",
          data: { externalId: 999 },
          metadata: null,
        },
      ],
      shipping_total: 42,
    }
    const payload = buildShippingForecastEvent(order, ENV_PACKAGING_ON)
    expect(payload).not.toBeNull()
    expect(payload!.properties.service).toBe("GROUND")
  })
})

describe("evaluateGbm column guard (.kind defense-in-depth)", () => {
  it("does not throw `reading 'kind'` when a model column is undefined/malformed", () => {
    const model: any = {
      status: "trained",
      schema_version: "shipping_cost_forecast_v3",
      model_type: "hist_gbm",
      baseline: 10,
      // A malformed/partially-uploaded column set: undefined + missing-kind entries.
      columns: [undefined, { name: "subtotal" }, { kind: "num", name: "subtotal" }],
      service_levels: [],
      zip3_zone: {},
      state_zone: {},
      default_zone: 5,
      trees: [],
    }
    const input: any = {
      service: "GROUND",
      ship_state: "GA",
      ship_postal_code: "30301",
      subtotal: 100,
      line_count: 1,
      unit_count: 1,
      fixed_line_count: 1,
      per_lb_line_count: 0,
      unknown_pricing_line_count: 0,
      estimated_product_weight_lb: 5,
    }
    expect(() => evaluateGbm(model, input)).not.toThrow()
    // baseline with empty trees → max(0, 10)
    expect(evaluateGbm(model, input)).toBe(10)
  })
})
