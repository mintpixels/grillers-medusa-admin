import {
  buildCartLifecycleEvent,
  cartItemCount,
  deriveCartCustomerType,
  deriveCartRouteMarket,
  recordCartLifecycleActivity,
} from "../communications/cart-activity"
import { syncCartLifecycleFromEvent } from "../communications/cart-lifecycle"

jest.mock("../communications/cart-lifecycle", () => ({
  syncCartLifecycleFromEvent: jest.fn(async () => ({ id: "gpcart_1" })),
}))

const mockedSync = syncCartLifecycleFromEvent as jest.MockedFunction<
  typeof syncCartLifecycleFromEvent
>

describe("cart-activity lifecycle capture", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("cartItemCount", () => {
    it("sums line-item quantities", () => {
      expect(
        cartItemCount({ items: [{ quantity: 2 }, { quantity: 3 }] } as any)
      ).toBe(5)
    })

    it("returns 0 for empty / missing carts", () => {
      expect(cartItemCount({ items: [] } as any)).toBe(0)
      expect(cartItemCount(null)).toBe(0)
      expect(cartItemCount(undefined)).toBe(0)
    })
  })

  describe("buildCartLifecycleEvent", () => {
    it("builds a gp_cart_created event for a cart with items", () => {
      const occurredAt = new Date("2026-07-01T12:00:00.000Z")
      const event = buildCartLifecycleEvent(
        {
          id: "cart_123",
          email: "shopper@example.com",
          currency_code: "usd",
          total: 8999,
          items: [{ quantity: 2 }],
          metadata: {},
        } as any,
        null,
        occurredAt
      )

      expect(event).toMatchObject({
        event_name: "gp_cart_created",
        cart_id: "cart_123",
        email: "shopper@example.com",
        customer_type: "dtc",
        route_market: "unknown",
        occurred_at: occurredAt,
        properties: {
          item_count: 2,
          value: 8999,
          currency_code: "usd",
        },
      })
    })

    it("does not track carts with no line items (empty carts are not recoverable)", () => {
      expect(
        buildCartLifecycleEvent({ id: "cart_empty", items: [] } as any)
      ).toBeNull()
      expect(
        buildCartLifecycleEvent({
          id: "cart_zero",
          items: [{ quantity: 0 }],
        } as any)
      ).toBeNull()
    })

    it("does not track carts without an id", () => {
      expect(
        buildCartLifecycleEvent({ items: [{ quantity: 1 }] } as any)
      ).toBeNull()
    })

    it("falls back to the customer email when the cart has none", () => {
      const event = buildCartLifecycleEvent(
        { id: "cart_1", email: null, items: [{ quantity: 1 }] } as any,
        { email: "member@example.com" } as any
      )
      expect(event?.email).toBe("member@example.com")
    })

    it("leaves email null for a guest cart with no email yet", () => {
      const event = buildCartLifecycleEvent(
        { id: "cart_1", items: [{ quantity: 1 }] } as any
      )
      expect(event?.email).toBeNull()
    })
  })

  describe("deriveCartCustomerType", () => {
    it("defaults to dtc (never 'unknown', which matches no recovery flow)", () => {
      expect(deriveCartCustomerType({ id: "cart_1" } as any, null)).toBe("dtc")
    })

    it("detects institutional customers by group name", () => {
      expect(
        deriveCartCustomerType({ id: "cart_1" } as any, {
          groups: [{ name: "Institutional Wholesale" }],
        } as any)
      ).toBe("institutional")
    })

    it("detects institutional customers by group metadata flag", () => {
      expect(
        deriveCartCustomerType({ id: "cart_1" } as any, {
          groups: [{ name: "Region A", metadata: { institutional: true } }],
        } as any)
      ).toBe("institutional")
    })

    it("detects institutional from cart metadata", () => {
      expect(
        deriveCartCustomerType(
          { id: "cart_1", metadata: { customer_type: "institutional" } } as any,
          null
        )
      ).toBe("institutional")
    })
  })

  describe("deriveCartRouteMarket", () => {
    it("reads route_market from cart metadata", () => {
      expect(
        deriveCartRouteMarket(
          { id: "cart_1", metadata: { route_market: "southeast" } } as any,
          null
        )
      ).toBe("southeast")
    })

    it("defaults to unknown", () => {
      expect(deriveCartRouteMarket({ id: "cart_1" } as any, null)).toBe(
        "unknown"
      )
    })
  })

  describe("recordCartLifecycleActivity", () => {
    it("calls syncCartLifecycleFromEvent with the built event", async () => {
      const db = {} as any
      const result = await recordCartLifecycleActivity(
        db,
        { id: "cart_9", items: [{ quantity: 1 }], total: 100 } as any,
        null
      )

      expect(mockedSync).toHaveBeenCalledTimes(1)
      const [passedDb, passedEvent] = mockedSync.mock.calls[0]
      expect(passedDb).toBe(db)
      expect(passedEvent).toMatchObject({
        event_name: "gp_cart_created",
        cart_id: "cart_9",
      })
      expect(result).toEqual({ id: "gpcart_1" })
    })

    it("skips (does not call the service) for an untrackable cart", async () => {
      const result = await recordCartLifecycleActivity(
        {} as any,
        { id: "cart_empty", items: [] } as any
      )
      expect(mockedSync).not.toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })
})
