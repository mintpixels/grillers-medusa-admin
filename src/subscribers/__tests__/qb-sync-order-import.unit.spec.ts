import { postOrderToQbSync } from "../qb-sync-order-import"

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
        headers: {
          "Content-Type": "application/json",
          "X-QB-Sync-Token": "sync-token",
        },
        body: JSON.stringify({ order: { id: "order_1" } }),
      })
    )
  })
})
