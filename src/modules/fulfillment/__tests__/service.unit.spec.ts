import GrillersFulfillmentProviderService from "../service"

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
}

function service() {
  return new GrillersFulfillmentProviderService({ logger } as any, {})
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
