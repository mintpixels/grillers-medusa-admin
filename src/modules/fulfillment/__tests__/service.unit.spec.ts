import GrillersFulfillmentProviderService from "../service"
import { emitOpsAlert } from "../../../lib/ops-alert"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

jest.mock("../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
}

const wwexEnv = {
  WWEX_AUTH_URL: "https://auth.example.test/oauth/token",
  WWEX_API_BASE_URL: "https://speedship.example.test/svc",
  WWEX_CLIENT_ID: "client_id",
  WWEX_CLIENT_SECRET: "client_secret",
  WWEX_AUDIENCE: "audience",
  WWEX_ORIGIN_ADDRESS_1: "123 Plant Rd",
  WWEX_ORIGIN_CITY: "Doraville",
  WWEX_ORIGIN_STATE: "GA",
  WWEX_ORIGIN_POSTAL_CODE: "30340",
  WWEX_ORIGIN_PHONE: "7704548108",
}

const forecastEnv = {
  GRILLERS_SHIPPING_FORECAST_ENABLED: "true",
}

function service() {
  return new GrillersFulfillmentProviderService({ logger } as any, {})
}

function setWwexEnv() {
  Object.assign(process.env, wwexEnv)
}

function clearWwexEnv() {
  for (const key of Object.keys(wwexEnv)) {
    delete process.env[key]
  }
}

function clearForecastEnv() {
  delete process.env.GRILLERS_SHIPPING_FORECAST_ENABLED
  delete process.env.GRILLERS_SHIPPING_FORECAST_MODEL_PATH
  delete process.env.GRILLERS_SHIPPING_FORECAST_SAFETY_PERCENTILE
  delete process.env.GRILLERS_SHIPPING_FORECAST_MIN_USD
  delete process.env.GRILLERS_SHIPPING_FORECAST_MAX_USD
}

function writeConstantForecastModel(amount: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-shipping-forecast-"))
  const modelPath = path.join(dir, "model.json")
  fs.writeFileSync(
    modelPath,
    JSON.stringify({
      status: "trained",
      schema_version: "shipping_cost_forecast_v2",
      generated_at: "2026-06-16T00:00:00.000Z",
      smearing_factor: 1,
      features: {
        columns: ["__intercept"],
        numeric_stats: {},
      },
      coefficients: {
        __intercept: Math.log1p(amount),
      },
      fallbacks: {
        residual_abs_p75: 10,
        residual_abs_p90: 20,
      },
    })
  )
  return modelPath
}

function writeCorruptForecastModel() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-shipping-forecast-corrupt-"))
  const modelPath = path.join(dir, "model.json")
  fs.writeFileSync(modelPath, "{ not valid json")
  return modelPath
}

function mockShippingZones(zones: any[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: zones }),
  } as any)
}

const forecastCart = {
  shipping_address: { province: "VA", postal_code: "23219" },
  items: [
    {
      unit_price: 100,
      quantity: 2,
      metadata: { pricing_mode: "per lb", estimated_weight_lb: 1.2 },
    },
  ],
}

describe("GrillersFulfillmentProviderService", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    clearWwexEnv()
    clearForecastEnv()
  })

  it("exposes UPS Ground, 3 Day Select, 2nd Day Air, and Overnight services", async () => {
    const options = await service().getFulfillmentOptions()
    expect(options.map((option) => option.service_code)).toEqual(
      expect.arrayContaining([
        "GROUND",
        "3_DAY_SELECT",
        "2ND_DAY_AIR",
        "OVERNIGHT",
      ])
    )
  })

  it("rates UPS 3 Day Select from a dedicated Strapi shipping-zone row", async () => {
    mockShippingZones([
      {
        ZoneCode: "FedexOvernight",
        Description: "Overnight Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 160 }],
      },
      {
        ZoneCode: "Fedex3Day",
        Description: "3 Day Select Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 75 }],
      },
    ])

    const result = await service().calculatePrice(
      { service_code: "3_DAY_SELECT" } as any,
      {
        shipping_address: { postal_code: "90048" },
        items: [{ unit_price: 100, quantity: 1, metadata: {} }],
      } as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(75)
  })

  it("uses WWEX Speedship quotes for UPS services when configured", async () => {
    setWwexEnv()
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "token", expires_in: 86400 }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientStatus: { success: true },
          response: {
            offerList: [
              {
                offerId: "offer-ground",
                productTransactionId: "ptr-ground",
                offeredProductList: [
                  {
                    offerPrice: { value: 17.59, unit: "USD" },
                    shopRQShipment: {
                      timeInTransit: {
                        upsServiceCode: "GND",
                        transitDays: 1,
                        estimatedDeliveryDate: "2026-06-17",
                      },
                    },
                  },
                ],
              },
            ],
          },
        }),
      } as any)

    const result = await service().calculatePrice(
      { service_code: "GROUND" } as any,
      {
        shipping_address: {
          address_1: "3838 Oak Lawn Ave",
          city: "Highland Park",
          province: "TX",
          postal_code: "75219",
          country_code: "US",
          first_name: "Test",
          last_name: "Customer",
          phone: "2148798521",
        },
        items: [{ unit_price: 100, quantity: 1, metadata: {} }],
      } as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(17.59)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("uses the historical shipping forecast (mean + p75 buffer) for UPS rates only when enabled", async () => {
    Object.assign(process.env, forecastEnv, {
      GRILLERS_SHIPPING_FORECAST_MODEL_PATH: writeConstantForecastModel(42),
    })
    mockShippingZones([
      {
        ZoneCode: "FedexGround",
        Description: "Ground Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 75 }],
      },
    ])

    const result = await service().calculatePrice(
      { service_code: "GROUND" } as any,
      forecastCart as any,
      {} as any
    )

    // mean 42 + p75 residual buffer 10 = 52; forecast short-circuits before Strapi
    expect(result.calculated_amount).toBe(52)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("respects GRILLERS_SHIPPING_FORECAST_SAFETY_PERCENTILE=p50 (no buffer)", async () => {
    Object.assign(process.env, forecastEnv, {
      GRILLERS_SHIPPING_FORECAST_MODEL_PATH: writeConstantForecastModel(42),
      GRILLERS_SHIPPING_FORECAST_SAFETY_PERCENTILE: "p50",
    })

    const result = await service().calculatePrice(
      { service_code: "GROUND" } as any,
      forecastCart as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(42)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("treats a degenerate $0 forecast as non-confident and falls through to the Strapi tier", async () => {
    Object.assign(process.env, forecastEnv, {
      GRILLERS_SHIPPING_FORECAST_MODEL_PATH: writeConstantForecastModel(0),
    })
    mockShippingZones([
      {
        ZoneCode: "FedexGround",
        Description: "Ground Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 75 }],
      },
    ])

    const result = await service().calculatePrice(
      { service_code: "GROUND" } as any,
      forecastCart as any,
      {} as any
    )

    // $0 point estimate => fall through to the conservative Strapi tier (75)
    expect(result.calculated_amount).toBe(75)
    expect(global.fetch).toHaveBeenCalled()
  })

  it("does not crash and falls through to Strapi when the model file is corrupt", async () => {
    Object.assign(process.env, forecastEnv, {
      GRILLERS_SHIPPING_FORECAST_MODEL_PATH: writeCorruptForecastModel(),
    })
    mockShippingZones([
      {
        ZoneCode: "FedexGround",
        Description: "Ground Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 75 }],
      },
    ])

    // constructing the provider with a corrupt model must not throw (boot-safe)
    const svc = service()
    const result = await svc.calculatePrice(
      { service_code: "GROUND" } as any,
      forecastCart as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(75)
  })

  it("falls back to the conservative Overnight row for expedited UPS services without dedicated rows", async () => {
    mockShippingZones([
      {
        ZoneCode: "FedexGround",
        Description: "Ground Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 40 }],
      },
      {
        ZoneCode: "FedexOvernight",
        Description: "Overnight Estimated Shipping Charge",
        ShippingZoneBreakpoints: [{ BreakpointPrice: 0, ShippingRate: 160 }],
      },
    ])

    const result = await service().calculatePrice(
      { service_code: "2ND_DAY_AIR" } as any,
      {
        shipping_address: { postal_code: "90048" },
        items: [{ unit_price: 100, quantity: 1, metadata: {} }],
      } as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(160)
  })

  it("fails closed when no Strapi shipping-zone tier matches", async () => {
    mockShippingZones([])

    await expect(
      service().calculatePrice(
        { service_code: "GROUND" } as any,
        {
          shipping_address: { postal_code: "30340" },
          items: [{ unit_price: 100, quantity: 1, metadata: {} }],
        } as any,
        {} as any
      )
    ).rejects.toThrow(
      "No configured shipping rate tier matched service GROUND for 30340."
    )
  })

  it("emits an ops alert if a shipping provider returns the legacy -10 sentinel", async () => {
    const svc = service()
    ;(svc as any).client.calculate = jest.fn(async () => -10)

    const result = await svc.calculatePrice(
      { service_code: "GROUND" } as any,
      {
        shipping_address: { postal_code: "30340" },
      } as any,
      {} as any
    )

    expect(result.calculated_amount).toBe(-10)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "shipping_calculate_price_sentinel",
        path: "src/modules/fulfillment/service.ts",
        meta: expect.objectContaining({
          service_code: "GROUND",
          postal_code: "30340",
        }),
      })
    )
  })
})
