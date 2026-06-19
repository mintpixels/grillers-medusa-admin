import { createHash } from "node:crypto"
import { emitOpsAlert } from "../ops-alert"

const ENDPOINT = "https://ingestion.example.com"
const SERVER_KEY = "gp-server-key"

function expectedFingerprint(
  source: string,
  alertKind: string,
  normalizedTitle: string
): string {
  return createHash("sha1")
    .update(`${source}:${alertKind}:${normalizedTitle}`)
    .digest("hex")
}

describe("emitOpsAlert", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("skips and no-ops without gp-analytics ingestion credentials", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: "",
      GP_ANALYTICS_SERVER_KEY: "",
    }
    global.fetch = jest.fn() as any

    const result = await emitOpsAlert({
      alertKind: "unit",
      title: "Unit",
      path: "src/lib/ops-alert.ts",
      logger: logger as any,
    })

    expect(result).toEqual({ ok: false, skipped: true })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("skipped unit")
    )
  })

  it("posts ops_alert to the gp ingestion /v1/track endpoint with Bearer auth (page = awaited)", async () => {
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: `${ENDPOINT}/`,
      GP_ANALYTICS_SERVER_KEY: SERVER_KEY,
      NODE_ENV: "production",
      RAILWAY_GIT_COMMIT_SHA: "deadbeef",
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    const result = await emitOpsAlert({
      alertKind: "charge_failed_hold",
      title: "Final charge failed for order order_123",
      path: "src/lib/final-charge-ops-alerts.ts",
      source: "medusa",
      severity: "page",
      meta: { order_id: "order_123" },
    })

    expect(result).toEqual({ ok: true, skipped: false })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ingestion.example.com/v1/track",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVER_KEY}`,
        }),
      })
    )

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.event).toBe("ops_alert")
    expect(body.source).toBe("medusa-server")
    expect(typeof body.event_id).toBe("string")
    expect(typeof body.session_id).toBe("string")
    expect(body.properties).toMatchObject({
      alert_kind: "charge_failed_hold",
      severity: "page",
      path: "src/lib/final-charge-ops-alerts.ts",
      title: "Final charge failed for order order_123",
      release: "deadbeef",
      env: "production",
      order_id: "order_123",
    })

    // fingerprint normalizes title: lowercases, strips order_ ids + digits.
    expect(body.properties.fingerprint).toBe(
      expectedFingerprint(
        "medusa",
        "charge_failed_hold",
        "final charge failed for order"
      )
    )
  })

  it("collapses per-order titles to a single fingerprint", async () => {
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: ENDPOINT,
      GP_ANALYTICS_SERVER_KEY: SERVER_KEY,
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    await emitOpsAlert({
      alertKind: "charge_failed_hold",
      title: "Final charge failed for order order_AAA",
      path: "p",
      source: "medusa",
      severity: "page",
    })
    await emitOpsAlert({
      alertKind: "charge_failed_hold",
      title: "Final charge failed for order order_ZZZ_999",
      path: "p",
      source: "medusa",
      severity: "page",
    })

    const first = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    const second = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)
    expect(first.properties.fingerprint).toBe(second.properties.fingerprint)
  })

  it("honors an explicit fingerprint override", async () => {
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: ENDPOINT,
      GP_ANALYTICS_SERVER_KEY: SERVER_KEY,
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    await emitOpsAlert({
      alertKind: "unit",
      title: "Unit",
      path: "p",
      severity: "page",
      fingerprint: "custom-fingerprint",
    })

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.properties.fingerprint).toBe("custom-fingerprint")
  })

  it("defaults severity to warn and fire-and-forgets non-page alerts", async () => {
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: ENDPOINT,
      GP_ANALYTICS_SERVER_KEY: SERVER_KEY,
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    const result = await emitOpsAlert({
      alertKind: "shipping_calculate_price_sentinel",
      title: "Shipping calculatePrice returned -10 sentinel",
      path: "src/modules/fulfillment/service.ts",
      source: "medusa",
    })

    // fire-and-forget returns ok immediately
    expect(result).toEqual({ ok: true, skipped: false })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ingestion.example.com/v1/track",
      expect.objectContaining({ method: "POST" })
    )

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.event).toBe("ops_alert")
    expect(body.properties.severity).toBe("warn")
  })

  it("logs an error on a non-ok page response", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: ENDPOINT,
      GP_ANALYTICS_SERVER_KEY: SERVER_KEY,
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "validation error",
    }) as any

    const result = await emitOpsAlert({
      alertKind: "charge_failed_hold",
      title: "Final charge failed for order order_123",
      path: "p",
      severity: "page",
      logger: logger as any,
    })

    expect(result).toEqual({ ok: false, skipped: false })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("charge_failed_hold failed")
    )
  })
})
