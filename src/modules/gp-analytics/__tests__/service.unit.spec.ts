import GpAnalyticsProviderService from "../service"

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
        route_market: "core",
        fulfillment_tier: "pickup",
        customer_type: "dtc",
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
    expect(body.fulfillment_tier).toBe("pickup")
    expect(body.customer_type).toBe("dtc")
    expect(body.properties.transaction_id).toBe("order_123")
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
