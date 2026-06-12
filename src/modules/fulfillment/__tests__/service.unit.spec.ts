import GrillersFulfillmentProviderService from "../service"

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

function mockShippingZones(zones: any[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: zones }),
  } as any)
}

describe("GrillersFulfillmentProviderService", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    clearWwexEnv()
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
})
