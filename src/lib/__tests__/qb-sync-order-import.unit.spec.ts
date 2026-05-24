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
})
