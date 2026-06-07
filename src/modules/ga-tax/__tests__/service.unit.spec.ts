import GeorgiaTaxProvider from "../service"

const logger = {
  warn: jest.fn(),
} as any

describe("GeorgiaTaxProvider", () => {
  beforeEach(() => {
    logger.warn.mockClear()
  })

  it("uses Georgia food tax rates and keeps delivery non-taxable", async () => {
    const provider = new GeorgiaTaxProvider({ logger })

    const lines = await provider.getTaxLines(
      [
        {
          line_item: { id: "line_1" },
          rates: [{ id: "rate_1", rate: 6, name: "GA Tax", code: "US-DEFAULT" }],
        } as any,
      ],
      [
        {
          shipping_line: { id: "ship_1" },
          rates: [{ id: "rate_1", rate: 6, name: "GA Tax", code: "US-DEFAULT" }],
        } as any,
      ],
      { address: { province_code: "GA", postal_code: "30062" } } as any
    )

    expect(lines).toEqual([
      expect.objectContaining({
        line_item_id: "line_1",
        rate: 2,
        name: "GA Food Tax (2%)",
      }),
      expect.objectContaining({
        shipping_line_id: "ship_1",
        rate: 0,
        name: "Shipping Tax Exempt",
      }),
    ])
  })

  it("keeps out-of-state item and shipping lines non-taxable", async () => {
    const provider = new GeorgiaTaxProvider({ logger })

    const lines = await provider.getTaxLines(
      [
        {
          line_item: { id: "line_1" },
          rates: [{ id: "rate_1", rate: 8, name: "Default Tax", code: "US-DEFAULT" }],
        } as any,
      ],
      [
        {
          shipping_line: { id: "ship_1" },
          rates: [{ id: "rate_1", rate: 8, name: "Default Tax", code: "US-DEFAULT" }],
        } as any,
      ],
      { address: { province_code: "NY", postal_code: "10024" } } as any
    )

    expect(lines).toEqual([
      expect.objectContaining({
        line_item_id: "line_1",
        rate: 0,
        name: "Out-of-state Tax Exempt",
      }),
      expect.objectContaining({
        shipping_line_id: "ship_1",
        rate: 0,
        name: "Shipping Tax Exempt",
      }),
    ])
  })

  it("uses production QuickBooks food tax rates when a county tax item is configured", async () => {
    const provider = new GeorgiaTaxProvider({ logger })

    const lines = await provider.getTaxLines(
      [
        {
          line_item: { id: "line_1" },
          rates: [{ id: "rate_1", rate: 6, name: "GA Tax", code: "US-DEFAULT" }],
        } as any,
      ],
      [],
      { address: { province_code: "GA", postal_code: "30188" } } as any
    )

    expect(lines).toEqual([
      expect.objectContaining({
        line_item_id: "line_1",
        rate: 3,
        name: "GA Food Tax (3%)",
      }),
    ])
  })
})
