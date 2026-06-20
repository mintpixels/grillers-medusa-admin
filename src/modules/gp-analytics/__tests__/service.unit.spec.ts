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

  it("mirrors guest order_completed with a synthesized anonymous_id instead of skipping", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    // A guest checkout: no actor_id, no customer_id, no anonymous_id.
    await service.track({
      event: "order_completed",
      properties: {
        transaction_id: "order_guest_1",
        cart_id: "cart_guest_1",
        route_market: "national",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_guest_1:order_completed",
      },
    } as any)

    // It must NOT be dropped — both the legacy Jitsu pipe and the GP pipe fire.
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const gpCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).startsWith("https://analytics.example.com/v1/track")
    )
    expect(gpCall).toBeTruthy()

    const body = JSON.parse(gpCall[1].body)
    // Schema anyOf is satisfied via a real-uuid anonymous_id (user_id absent).
    expect(body.user_id).toBeUndefined()
    expect(body.anonymous_id).toMatch(UUID_RE)
    expect(body.properties.anonymous_id).toBe(body.anonymous_id)
    // Enum fields are normalized to schema-valid values for real order data.
    expect(body.route_market).toBe("national")
    expect(body.customer_type).toBe("dtc")
    expect(body.source).toBe("medusa-server")
    expect(body.experience_version).toBe("medusa")
    // It was NOT routed down the old skip path.
    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipping GP dual-run")
    )
  })

  it("synthesizes a STABLE anonymous_id across replays of the same guest order", async () => {
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
      properties: {
        transaction_id: "order_guest_2",
        cart_id: "cart_guest_2",
        route_market: "national",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_guest_2:order_completed",
      },
    } as any

    await service.track(event)
    await service.track(event)

    const gpBodies = (global.fetch as jest.Mock).mock.calls
      .filter(([url]) =>
        String(url).startsWith("https://analytics.example.com")
      )
      .map(([, init]) => JSON.parse(init.body))

    expect(gpBodies).toHaveLength(2)
    expect(gpBodies[0].anonymous_id).toMatch(UUID_RE)
    expect(gpBodies[0].anonymous_id).toBe(gpBodies[1].anonymous_id)
  })

  it("logs a non-2xx GP analytics response for a guest order (observable failure)", async () => {
    ;(global.fetch as jest.Mock).mockImplementation((url) => {
      if (String(url).startsWith("https://analytics.example.com")) {
        return Promise.resolve({
          ok: false,
          status: 422,
          text: () => Promise.resolve("anonymous_id must be uuid\ntrailing"),
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
      properties: {
        transaction_id: "order_guest_3",
        cart_id: "cart_guest_3",
        route_market: "national",
        customer_type: "dtc",
      },
    } as any)
    await Promise.resolve()
    await Promise.resolve()

    expect(logger.warn).toHaveBeenCalledWith(
      "Analytics: GP analytics rejected order_completed with 422: anonymous_id must be uuid"
    )
  })

  it("mirrors identity-less ad-hoc server events with a random anonymous_id", async () => {
    const service = new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

    // No identity AND no stable seed (no order/cart/transaction/idempotency).
    await service.track({
      event: "inventory_reconciled",
      properties: {
        route_market: "national",
      },
    } as any)

    // Both pipes fire — the event is no longer silently dropped.
    expect(global.fetch).toHaveBeenCalledTimes(2)
    const gpCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).startsWith("https://analytics.example.com/v1/track")
    )
    expect(gpCall).toBeTruthy()

    const body = JSON.parse(gpCall[1].body)
    expect(body.user_id).toBeUndefined()
    expect(body.anonymous_id).toMatch(UUID_RE)
    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipping GP dual-run")
    )
  })

  it("keeps the real user_id and backfills a stable anonymous_id for identified orders", async () => {
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
      actor_id: "cus_999",
      properties: {
        transaction_id: "order_id_999",
        cart_id: "cart_999",
        route_market: "national",
        customer_type: "dtc",
      },
    } as any)

    const gpCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).startsWith("https://analytics.example.com/v1/track")
    )
    const body = JSON.parse(gpCall[1].body)
    expect(body.user_id).toBe("cus_999")
    expect(body.anonymous_id).toMatch(UUID_RE)
  })

  const newService = () =>
    new GpAnalyticsProviderService(
      { logger } as any,
      {
        jitsuHost: "https://jitsu.example.com",
        jitsuServerSecret: "jitsu-secret",
        gpAnalyticsEndpoint: "https://analytics.example.com/",
        gpAnalyticsServerKey: "server-key",
      }
    )

  const gpBodiesOf = () =>
    (global.fetch as jest.Mock).mock.calls
      .filter(([url]) =>
        String(url).startsWith("https://analytics.example.com")
      )
      .map(([, init]) => JSON.parse(init.body))

  // P1a — deterministic event_timestamp_ms across replays.
  it("emits an IDENTICAL deterministic event_timestamp_ms across replays of the same order event", async () => {
    const service = newService()
    const event = {
      event: "order_completed",
      actor_id: "cus_ts",
      properties: {
        transaction_id: "order_ts_1",
        cart_id: "cart_ts_1",
        route_market: "national",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_ts_1:order_completed",
      },
    } as any

    await service.track(event)
    await service.track(event)

    const bodies = gpBodiesOf()
    expect(bodies).toHaveLength(2)
    // The whole dedup key (event_name, timestamp, event_id) must be identical so
    // ReplacingMergeTree collapses the replay and daily_revenue never doubles.
    expect(bodies[0].event_timestamp_ms).toBe(bodies[1].event_timestamp_ms)
    expect(bodies[0].event_id).toBe(bodies[1].event_id)
    expect(typeof bodies[0].event_timestamp_ms).toBe("number")
    // It is NOT Date.now() (which would differ between the two replays) — it's
    // deterministically derived from the seed and lands in a bounded window
    // anchored at the GP analytics epoch (2024-01-01 .. +2y).
    const epoch = Date.UTC(2024, 0, 1)
    expect(bodies[0].event_timestamp_ms).toBeGreaterThanOrEqual(epoch)
    expect(bodies[0].event_timestamp_ms).toBeLessThan(
      epoch + 2 * 365 * 24 * 60 * 60 * 1000
    )
  })

  it("prefers an explicit occurred-at (order_created_at) for the deterministic timestamp", async () => {
    const service = newService()
    const createdAt = "2026-06-12T15:30:00.000Z"
    await service.track({
      event: "order_completed",
      actor_id: "cus_ts2",
      properties: {
        transaction_id: "order_ts_2",
        order_created_at: createdAt,
        route_market: "national",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_ts_2:order_completed",
      },
    } as any)

    const body = gpBodiesOf()[0]
    expect(body.event_timestamp_ms).toBe(Date.parse(createdAt))
  })

  // P2 — PII is stripped from the GP mirror but ids are kept.
  it("strips raw PII (email/name/phone/address) from the GP mirror while keeping ids", async () => {
    const service = newService()
    await service.track({
      event: "order_completed",
      actor_id: "cus_pii",
      properties: {
        transaction_id: "order_pii_1",
        cart_id: "cart_pii_1",
        customer_id: "cus_pii",
        order_id: "order_pii_1",
        value: 142.5,
        email: "guest@example.com",
        first_name: "Guest",
        last_name: "Buyer",
        phone: "+15551234567",
        shipping_address: { address_1: "1 Main St", postal_code: "30305" },
        dest_postal_code: "30305",
        route_market: "atlanta_metro",
        customer_type: "dtc",
        idempotency_key: "order.placed:order_pii_1:order_completed",
      },
    } as any)

    const gpBody = gpBodiesOf()[0]
    // PII gone from the mirror properties.
    expect(gpBody.properties.email).toBeUndefined()
    expect(gpBody.properties.first_name).toBeUndefined()
    expect(gpBody.properties.last_name).toBeUndefined()
    expect(gpBody.properties.phone).toBeUndefined()
    expect(gpBody.properties.shipping_address).toBeUndefined()
    // No top-level PII leaked either.
    expect(gpBody.email).toBeUndefined()
    // IDs and coarse geo retained.
    expect(gpBody.properties.order_id).toBe("order_pii_1")
    expect(gpBody.properties.customer_id).toBe("cus_pii")
    expect(gpBody.properties.value).toBe(142.5)
    expect(gpBody.properties.dest_postal_code).toBe("30305")
    expect(gpBody.user_id).toBe("cus_pii")

    // The legacy Jitsu payload is UNCHANGED — it still carries the raw email.
    const jitsuCall = (global.fetch as jest.Mock).mock.calls.find(([url]) =>
      String(url).includes("/api/v1/s2s/event")
    )
    expect(jitsuCall).toBeTruthy()
    const jitsuBody = JSON.parse(jitsuCall[1].body)
    expect(jitsuBody.eventn_ctx.email).toBe("guest@example.com")
    expect(jitsuBody.eventn_ctx.first_name).toBe("Guest")
  })

  // P3 — order_shipped seeded from fulfillment_id is deterministic across replays.
  it("keeps order_shipped event_id + anonymous_id stable across replays when seeded from fulfillment_id", async () => {
    const service = newService()
    const event = {
      event: "order_shipped",
      properties: {
        fulfillment_id: "ful_123",
        order_id: "order_ship_1",
        idempotency_key: "order_shipped:order_ship_1:ful_123",
        medusa_event_id: "order_shipped:order_ship_1:ful_123",
      },
    } as any

    await service.track(event)
    await service.track(event)

    const bodies = gpBodiesOf()
    expect(bodies).toHaveLength(2)
    expect(bodies[0].event_id).toBe(bodies[1].event_id)
    expect(bodies[0].anonymous_id).toBe(bodies[1].anonymous_id)
    expect(bodies[0].event_timestamp_ms).toBe(bodies[1].event_timestamp_ms)
    expect(bodies[0].idempotency_key).toBe(
      "order_shipped:order_ship_1:ful_123"
    )
  })
})
