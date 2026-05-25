import {
  ORDER_FIELDS,
  buildQbSyncSignature,
  normalizeOrderForQbSync,
  postOrderToQbSync,
} from "../../subscribers/qb-sync-order-import"

describe("qb-sync order import subscriber", () => {
  it("posts order payloads with the shared sync token", async () => {
    const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }))

    await postOrderToQbSync(
      "https://sync.example.test/api/medusa/orders",
      "sync-token",
      { id: "order_1" },
      fetchMock as unknown as typeof fetch
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.test/api/medusa/orders",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-QB-Sync-Token": "sync-token",
          "X-QB-Sync-Timestamp": expect.any(String),
          "X-QB-Sync-Signature": expect.any(String),
        }),
        body: JSON.stringify({ order: { id: "order_1" } }),
      })
    )
  })

  it("signs order import payloads with a timestamped HMAC", () => {
    expect(buildQbSyncSignature('{"order":{"id":"order_1"}}', "123", "secret"))
      .toHaveLength(64)
  })

  it("requests order item relations that include Medusa computed quantity and variant data", () => {
    expect(ORDER_FIELDS).toEqual(
      expect.arrayContaining([
        "items.*",
        "items.detail.*",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_address.*",
        "billing_address.*",
      ])
    )
    expect(ORDER_FIELDS).not.toContain("*items")
    expect(ORDER_FIELDS).not.toContain("*shipping_address")
  })

  it("normalizes Medusa order line totals when graph payloads omit computed item fields", () => {
    const order = normalizeOrderForQbSync({
      id: "order_1",
      total: 0,
      subtotal: 0,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: null,
          detail: { quantity: 2 },
          unit_price: 84.9,
          total: 0,
          subtotal: null,
        },
      ],
    })

    expect(order.total).toBe(169.8)
    expect(order.subtotal).toBe(169.8)
    expect((order.items as any[])[0]).toMatchObject({
      quantity: 2,
      total: 169.8,
      subtotal: 169.8,
    })
  })

  it("prefers Medusa raw line totals for multi-quantity orders", () => {
    const order = normalizeOrderForQbSync({
      id: "order_2",
      total: 84.9,
      subtotal: 84.9,
      item_total: 169.8,
      item_subtotal: 169.8,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 1,
          detail: { quantity: 2 },
          unit_price: 84.9,
          total: 84.9,
          subtotal: 84.9,
          raw_quantity: { value: "2", precision: 20 },
          raw_total: { value: "169.8", precision: 20 },
          raw_subtotal: { value: "169.8", precision: 20 },
        },
      ],
    })

    expect(order.total).toBe(169.8)
    expect(order.subtotal).toBe(169.8)
    expect((order.items as any[])[0]).toMatchObject({
      quantity: 2,
      total: 169.8,
      subtotal: 169.8,
    })
  })

  it("keeps tax in the QuickBooks expected total when Medusa total is pre-tax", () => {
    const order = normalizeOrderForQbSync({
      id: "order_3",
      total: 84.9,
      subtotal: 84.9,
      item_total: 91.47975,
      item_subtotal: 84.9,
      shipping_total: 0,
      tax_total: 6.57975,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 1,
          unit_price: 84.9,
          total: 84.9,
          subtotal: 84.9,
          tax_total: 6.57975,
          raw_total: { value: "91.47975", precision: 20 },
          raw_subtotal: { value: "84.9", precision: 20 },
        },
      ],
    })

    expect(order.total).toBe(91.47975)
    expect(order.subtotal).toBe(84.9)
    expect((order.items as any[])[0]).toMatchObject({
      total: 91.47975,
      subtotal: 84.9,
    })
  })
})
