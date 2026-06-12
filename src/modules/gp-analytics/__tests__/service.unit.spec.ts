import GpAnalyticsProviderService from "../service"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe("GpAnalyticsProviderService", () => {
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any
  })

  it("dual-runs tracked events to the GP analytics endpoint", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    await service.track({
      event: "order_completed",
      actor_id: "cus_123",
      properties: {
        transaction_id: "order_123",
        cart_id: "cart_123",
        route_market: "core",
        fulfillment_tier: "plant_pickup",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_123:order_completed",
      },
    } as any)

    expect(global.fetch).toHaveBeenCalledTimes(2)
    const gpCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).startsWith("https://analytics.example.com/v1/track")
    )

    expect(gpCall).toBeTruthy()
    const [, init] = gpCall
    const body = JSON.parse(init.body)

    expect(init.headers.Authorization).toBe("Bearer server-key")
    expect(body.event).toBe("order_completed")
    expect(body.user_id).toBe("cus_123")
    expect(body.source).toBe("medusa-server")
    expect(body.route_market).toBe("atlanta_metro")
    expect(body.fulfillment_tier).toBe("plant_pickup")
    expect(body.customer_type).toBe("dtc")
    expect(body.idempotency_key).toBe("order.placed:order_123:order_completed")
    expect(body.event_id).toMatch(UUID_RE)
    expect(body.session_id).toMatch(UUID_RE)
    expect(body.session_id).not.toBe("cart_123")
    expect(body.properties.transaction_id).toBe("order_123")
    expect(body.properties.order_id).toBe("order_123")
    expect(body.properties.cart_id).toBe("cart_123")
    expect(body.properties.session_id).toBe(body.session_id)
  })

  it("derives stable mirror ids and sessions for replayed order events", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    const event = {
      event: "order_completed",
      actor_id: "cus_123",
      properties: {
        transaction_id: "order_123",
        cart_id: "cart_123",
        session_id: "cart_123",
        route_market: "national",
        fulfillment_tier: "UPS Ground Estimated Shipping",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_123:order_completed",
      },
    } as any

    await service.track(event)
    await service.track(event)

    const gpBodies = (global.fetch as jest.Mock).mock.calls
      .filter(([url]) => String(url).startsWith("https://analytics.example.com"))
      .map(([, init]) => JSON.parse(init.body))

    expect(gpBodies).toHaveLength(2)
    expect(gpBodies[0].event_id).toBe(gpBodies[1].event_id)
    expect(gpBodies[0].session_id).toBe(gpBodies[1].session_id)
    expect(gpBodies[0].session_id).toMatch(UUID_RE)
    expect(gpBodies[0].fulfillment_tier).toBe("ups_ground")
  })

  it("logs GP analytics non-2xx responses with status and first body line", async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url) => {
      if (String(url).startsWith("https://analytics.example.com")) {
        return Promise.resolve({
          ok: false,
          status: 400,
          text: () => Promise.resolve("session_id must be uuid\nsecond line"),
        })
      }

      return Promise.resolve({ ok: true })
    })

    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    await service.track({
      event: "order_completed",
      actor_id: "cus_123",
      properties: {
        transaction_id: "order_123",
        cart_id: "cart_123",
        customer_type: "dtc",
        route_market: "national",
      },
    } as any)
    await Promise.resolve()
    await Promise.resolve()

    expect(logger.warn).toHaveBeenCalledWith(
      "Analytics: GP analytics rejected order_completed with 400: session_id must be uuid"
    )
  })

  it("keeps order_finalized out of the legacy Jitsu pipe", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    await service.track({
      event: "order_finalized",
      actor_id: "cus_123",
      properties: {
        transaction_id: "order_123",
        cart_id: "cart_123",
        source: "staff_impersonation",
        customer_type: "dtc",
        route_market: "national",
      },
    } as any)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toBe(
      "https://analytics.example.com/v1/track"
    )

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.source).toBe("admin")
    expect(body.event).toBe("order_finalized")
  })

  it("does not mirror anonymous server events without an identity", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    await service.track({
      event: "inventory_reconciled",
      properties: {
        route_market: "national",
      },
    } as any)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      "https://jitsu.example.com/api/v1/s2s/event"
    )
    expect(logger.debug).toHaveBeenCalledWith(
      "Analytics: Skipping GP dual-run inventory_reconciled; no user_id or anonymous_id"
    )
  })
})
