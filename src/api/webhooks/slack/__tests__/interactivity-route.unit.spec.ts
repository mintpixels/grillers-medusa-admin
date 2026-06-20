import { createHmac } from "node:crypto"
import {
  verifySlackSignature,
  rawBodyString,
} from "../_shared/verify"
import { emitOpsAlertAck } from "../_shared/emit-ack"
import {
  OPS_ACK_ACTION_ID,
  ORDER_HOLD_ACTION_ID,
  ORDER_RELEASE_ACTION_ID,
  buildAckedMessage,
  buildOrderHoldMessage,
  extractAckAction,
  extractOrderAction,
  parseInteractivityPayload,
  POST,
} from "../interactivity/route"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const SIGNING_SECRET = "slack-signing-secret"

function signedHeaders(rawBody: string, ts: number) {
  const sig =
    "v0=" +
    createHmac("sha256", SIGNING_SECRET)
      .update(`v0:${ts}:${rawBody}`, "utf8")
      .digest("hex")
  return {
    "x-slack-signature": sig,
    "x-slack-request-timestamp": String(ts),
  }
}

function ackRawBody(
  fingerprint: string,
  opts: { responseUrl?: string; userId?: string; username?: string } = {}
): string {
  const payload = {
    type: "block_actions",
    response_url: opts.responseUrl ?? "https://hooks.slack.com/actions/T0/B0/x",
    user: { id: opts.userId ?? "U123", username: opts.username ?? "peter" },
    actions: [{ action_id: OPS_ACK_ACTION_ID, value: fingerprint }],
  }
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res
}

describe("verifySlackSignature (interactivity shared)", () => {
  const originalEnv = process.env

  afterEach(() => {
    process.env = originalEnv
  })

  it("fails closed when SLACK_SIGNING_SECRET is unset (no dev opt-in)", () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: "", NODE_ENV: "test" }
    const result = verifySlackSignature(
      { headers: {}, body: {} } as any,
      "payload=%7B%7D"
    )
    expect(result).toEqual({ ok: false, reason: "secret_not_configured" })
  })

  it("rejects unsigned in production even with the dev opt-in flag", () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: "",
      SLACK_ALLOW_UNSIGNED: "true",
      NODE_ENV: "production",
    }
    const result = verifySlackSignature(
      { headers: {}, body: {} } as any,
      "payload=%7B%7D"
    )
    expect(result.ok).toBe(false)
  })

  it("accepts unsigned only with explicit dev opt-in and non-prod", () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: "",
      SLACK_ALLOW_UNSIGNED: "true",
      NODE_ENV: "development",
    }
    const result = verifySlackSignature(
      { headers: {}, body: {} } as any,
      "payload=%7B%7D"
    )
    expect(result).toEqual({ ok: true })
  })

  it("accepts a correctly-signed request within the window", () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    const rawBody = ackRawBody("fp-1")
    const ts = Math.floor(Date.now() / 1000)
    const result = verifySlackSignature(
      { headers: signedHeaders(rawBody, ts), body: {} } as any,
      rawBody
    )
    expect(result).toEqual({ ok: true })
  })

  it("rejects a tampered body (signature mismatch)", () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    const rawBody = ackRawBody("fp-1")
    const ts = Math.floor(Date.now() / 1000)
    const headers = signedHeaders(rawBody, ts)
    const result = verifySlackSignature(
      { headers, body: {} } as any,
      ackRawBody("fp-TAMPERED")
    )
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" })
  })

  it("rejects a stale timestamp (replay guard, >5min)", () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    const rawBody = ackRawBody("fp-1")
    const ts = Math.floor(Date.now() / 1000) - 600 // 10 minutes old
    const result = verifySlackSignature(
      { headers: signedHeaders(rawBody, ts), body: {} } as any,
      rawBody
    )
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_range" })
  })

  it("rejects duplicate (array) signature headers", () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    const rawBody = ackRawBody("fp-1")
    const ts = Math.floor(Date.now() / 1000)
    const result = verifySlackSignature(
      {
        headers: {
          "x-slack-signature": ["v0=a", "v0=b"],
          "x-slack-request-timestamp": String(ts),
        },
        body: {},
      } as any,
      rawBody
    )
    expect(result).toEqual({ ok: false, reason: "missing_signature_headers" })
  })
})

describe("rawBodyString", () => {
  it("prefers the preserved raw body over a re-serialized parse", () => {
    expect(rawBodyString({ rawBody: "payload=abc", body: { x: 1 } } as any)).toBe(
      "payload=abc"
    )
  })
})

describe("parseInteractivityPayload / extractAckAction", () => {
  it("extracts fingerprint + user from an ack click", () => {
    const ack = extractAckAction(
      parseInteractivityPayload(
        ackRawBody("fp-abc", { userId: "U9", username: "dan" })
      )
    )
    expect(ack).toEqual({
      fingerprint: "fp-abc",
      ackedByUser: "U9",
      ackedByName: "dan",
    })
  })

  it("returns null for a non-ack action_id", () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        actions: [{ action_id: "something_else", value: "fp" }],
        user: { id: "U1" },
      }),
    }).toString()
    expect(extractAckAction(parseInteractivityPayload(raw))).toBeNull()
  })

  it("returns null when the ack button carries no fingerprint", () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        actions: [{ action_id: OPS_ACK_ACTION_ID, value: "" }],
        user: { id: "U1" },
      }),
    }).toString()
    expect(extractAckAction(parseInteractivityPayload(raw))).toBeNull()
  })

  it("returns null on malformed payload JSON", () => {
    const raw = "payload=%7Bnot-json"
    expect(parseInteractivityPayload(raw)).toBeNull()
    expect(extractAckAction(parseInteractivityPayload(raw))).toBeNull()
  })

  it("returns null when there is no payload field (e.g. url_verification)", () => {
    expect(parseInteractivityPayload("token=abc")).toBeNull()
  })
})

describe("buildAckedMessage", () => {
  it("replaces the original message with an acked-by line", () => {
    const msg = buildAckedMessage({
      fingerprint: "fp",
      ackedByUser: "U42",
    })
    expect(msg.replace_original).toBe(true)
    expect(JSON.stringify(msg)).toContain("<@U42>")
    expect(JSON.stringify(msg)).toContain("Acked by")
  })
})

describe("emitOpsAlertAck", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("skips and no-ops without ingestion credentials", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: "",
      GP_ANALYTICS_SERVER_KEY: "",
    }
    global.fetch = jest.fn() as any
    const result = await emitOpsAlertAck({
      fingerprint: "fp-x",
      ackedByUser: "U1",
      logger: logger as any,
    })
    expect(result).toEqual({ ok: false, skipped: true })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it("POSTs ops_alert_ack to /v1/track with Bearer auth and the right contract", async () => {
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com/",
      GP_ANALYTICS_SERVER_KEY: "gp-server-key",
      NODE_ENV: "production",
      RAILWAY_GIT_COMMIT_SHA: "deadbeef",
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    const result = await emitOpsAlertAck({
      fingerprint: "fp-abc",
      ackedByUser: "U9",
      ackedByName: "peter",
      alertKind: "checkout_500",
    })

    expect(result).toEqual({ ok: true, skipped: false })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ingestion.example.com/v1/track",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer gp-server-key",
        }),
      })
    )
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.event).toBe("ops_alert_ack")
    expect(body.source).toBe("medusa-server")
    expect(body.properties).toMatchObject({
      fingerprint: "fp-abc",
      acked_by_user: "U9",
      acked_by_name: "peter",
      alert_kind: "checkout_500",
      env: "production",
    })
  })

  it("fails soft (logs, returns not-ok) on a non-2xx ingestion response", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    process.env = {
      ...originalEnv,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "validation error",
    }) as any
    const result = await emitOpsAlertAck({
      fingerprint: "fp",
      ackedByUser: "U1",
      logger: logger as any,
    })
    expect(result).toEqual({ ok: false, skipped: false })
    expect(logger.error).toHaveBeenCalled()
  })
})

describe("interactivity POST handler", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  function makeReq(rawBody: string, headers: Record<string, unknown>) {
    return {
      rawBody,
      body: {},
      headers,
      scope: { resolve: () => ({ warn: jest.fn(), error: jest.fn() }) },
    } as any
  }

  it("returns 401 on an invalid signature and never emits", async () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    const fetchMock = jest.fn()
    global.fetch = fetchMock as any
    const rawBody = ackRawBody("fp-1")
    const res = makeRes()
    await POST(makeReq(rawBody, { "x-slack-signature": "v0=bad", "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)) }), res)
    expect(res.statusCode).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("emits ops_alert_ack and replies 200 on a valid ack click", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    const calls: Array<{ url: string; body: any }> = []
    global.fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return { ok: true } as any
    }) as any

    const rawBody = ackRawBody("fp-emit", { userId: "U7", username: "avi" })
    const ts = Math.floor(Date.now() / 1000)
    const res = makeRes()
    await POST(makeReq(rawBody, signedHeaders(rawBody, ts)), res)
    // Flush the fire-and-forget response_url post (not awaited by the handler).
    await new Promise((r) => setTimeout(r, 0))

    expect(res.statusCode).toBe(200)
    const ackCall = calls.find((c) => c.url.endsWith("/v1/track"))
    expect(ackCall?.body.event).toBe("ops_alert_ack")
    expect(ackCall?.body.properties.fingerprint).toBe("fp-emit")
    expect(ackCall?.body.properties.acked_by_user).toBe("U7")
    // response_url update was also posted to Slack (fire-and-forget).
    expect(calls.some((c) => c.url.includes("hooks.slack.com"))).toBe(true)
  })

  it("returns 200 ignored for a non-ack interaction", async () => {
    process.env = { ...originalEnv, SLACK_SIGNING_SECRET: SIGNING_SECRET }
    global.fetch = jest.fn() as any
    const raw = new URLSearchParams({
      payload: JSON.stringify({ type: "block_actions", actions: [] }),
    }).toString()
    const ts = Math.floor(Date.now() / 1000)
    const res = makeRes()
    await POST(makeReq(raw, signedHeaders(raw, ts)), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true, ignored: true })
  })
})

// ───────────────────────── approval-hold (order_hold / order_release) ─────────────────────────

function orderRawBody(
  actionId: string,
  orderId: string,
  opts: { responseUrl?: string; userId?: string; username?: string } = {}
): string {
  const payload = {
    type: "block_actions",
    response_url: opts.responseUrl ?? "https://hooks.slack.com/actions/T0/B0/x",
    user: { id: opts.userId ?? "U123", username: opts.username ?? "peter" },
    actions: [{ action_id: actionId, value: orderId }],
  }
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
}

describe("extractOrderAction", () => {
  it("extracts hold + order id + user from an order_hold click", () => {
    const action = extractOrderAction(
      parseInteractivityPayload(
        orderRawBody(ORDER_HOLD_ACTION_ID, "order_01H", {
          userId: "U9",
          username: "dan",
        })
      )
    )
    expect(action).toEqual({
      action: "hold",
      orderId: "order_01H",
      byUser: "U9",
      byName: "dan",
    })
  })

  it("extracts release from an order_release click", () => {
    const action = extractOrderAction(
      parseInteractivityPayload(orderRawBody(ORDER_RELEASE_ACTION_ID, "order_01R"))
    )
    expect(action?.action).toBe("release")
    expect(action?.orderId).toBe("order_01R")
  })

  it("returns null for an unknown action_id", () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        actions: [{ action_id: "something_else", value: "order_01X" }],
        user: { id: "U1" },
      }),
    }).toString()
    expect(extractOrderAction(parseInteractivityPayload(raw))).toBeNull()
  })

  it("returns null when the hold button carries no order_id value", () => {
    const raw = new URLSearchParams({
      payload: JSON.stringify({
        actions: [{ action_id: ORDER_HOLD_ACTION_ID, value: "" }],
        user: { id: "U1" },
      }),
    }).toString()
    expect(extractOrderAction(parseInteractivityPayload(raw))).toBeNull()
  })

  it("does not match an ops_ack action", () => {
    expect(
      extractOrderAction(parseInteractivityPayload(ackRawBody("fp-1")))
    ).toBeNull()
  })
})

describe("buildOrderHoldMessage", () => {
  it("renders the held text on a hold", () => {
    const msg = buildOrderHoldMessage({
      action: "hold",
      byName: "peter",
      byUser: "U1",
    })
    expect(msg.replace_original).toBe(true)
    expect(String(msg.text)).toContain("Held by peter")
    expect(String(msg.text)).toContain("fulfillment blocked")
  })

  it("renders the released text on a release", () => {
    const msg = buildOrderHoldMessage({
      action: "release",
      byName: "peter",
      byUser: "U1",
    })
    expect(String(msg.text)).toContain("Released by peter")
  })

  it("falls back to a user-mention when no name is present", () => {
    const msg = buildOrderHoldMessage({ action: "hold", byUser: "U42" })
    expect(JSON.stringify(msg)).toContain("<@U42>")
  })

  it("escapes mrkdwn-special characters in the display name", () => {
    const msg = buildOrderHoldMessage({
      action: "release",
      byName: "a<b>&c",
      byUser: "U1",
    })
    expect(String(msg.text)).toContain("a&lt;b&gt;&amp;c")
  })
})

describe("interactivity POST handler — order hold/release routing", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  // Build a req whose scope.resolve switches on the registration key so the
  // handler gets a fake QUERY (returns the given order), a fake ORDER module
  // (records updateOrders calls), and a logger.
  function makeOrderReq(
    rawBody: string,
    headers: Record<string, unknown>,
    opts: {
      order?: { id: string; metadata: unknown }
      // When true, the graph returns [] (order id does not resolve).
      notFound?: boolean
      updateOrders?: jest.Mock
    } = {}
  ) {
    const order = opts.notFound
      ? undefined
      : opts.order ?? { id: "order_01H", metadata: {} }
    const updateOrders = opts.updateOrders ?? jest.fn()
    const graph = jest
      .fn()
      .mockResolvedValue({ data: order ? [order] : [] })
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
    return {
      req: {
        rawBody,
        body: {},
        headers,
        scope: {
          resolve: (key: string) => {
            if (key === ContainerRegistrationKeys.QUERY) return { graph }
            if (key === Modules.ORDER) return { updateOrders }
            if (key === ContainerRegistrationKeys.LOGGER) return logger
            return logger
          },
        },
      } as any,
      graph,
      updateOrders,
      logger,
    }
  }

  function signedFetchCapture() {
    const calls: Array<{ url: string; body: any }> = []
    global.fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return { ok: true } as any
    }) as any
    return calls
  }

  it("order_hold sets metadata.fulfillment_hold.held === true (exact shape)", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    signedFetchCapture()
    const rawBody = orderRawBody(ORDER_HOLD_ACTION_ID, "order_01H", {
      userId: "U7",
      username: "avi",
    })
    const ts = Math.floor(Date.now() / 1000)
    const { req, updateOrders } = makeOrderReq(rawBody, signedHeaders(rawBody, ts), {
      order: { id: "order_01H", metadata: { existing: "keep" } },
    })
    const res = makeRes()
    await POST(req, res)
    await new Promise((r) => setTimeout(r, 0))

    expect(res.statusCode).toBe(200)
    expect(updateOrders).toHaveBeenCalledTimes(1)
    const [orderIdArg, payloadArg] = updateOrders.mock.calls[0]
    expect(orderIdArg).toBe("order_01H")
    expect(payloadArg.metadata.existing).toBe("keep")
    expect(payloadArg.metadata.fulfillment_hold).toMatchObject({
      held: true,
      held_by_user: "U7",
      held_by_name: "avi",
      reason: "slack_review",
    })
    expect(typeof payloadArg.metadata.fulfillment_hold.held_at_ms).toBe("number")
  })

  it("order_release sets held === false and PRESERVES the held_by audit trail", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    signedFetchCapture()
    const heldMetadata = {
      fulfillment_hold: {
        held: true,
        held_by_user: "U7",
        held_by_name: "avi",
        held_at_ms: 111,
        reason: "slack_review",
      },
    }
    const rawBody = orderRawBody(ORDER_RELEASE_ACTION_ID, "order_01R", {
      userId: "U8",
      username: "dan",
    })
    const ts = Math.floor(Date.now() / 1000)
    const { req, updateOrders } = makeOrderReq(rawBody, signedHeaders(rawBody, ts), {
      order: { id: "order_01R", metadata: heldMetadata },
    })
    const res = makeRes()
    await POST(req, res)
    await new Promise((r) => setTimeout(r, 0))

    expect(updateOrders).toHaveBeenCalledTimes(1)
    const hold = updateOrders.mock.calls[0][1].metadata.fulfillment_hold
    expect(hold.held).toBe(false)
    // audit trail of the original hold is preserved
    expect(hold.held_by_user).toBe("U7")
    expect(hold.held_by_name).toBe("avi")
    expect(hold.held_at_ms).toBe(111)
    expect(hold.reason).toBe("slack_review")
    // release trail is added
    expect(hold.released_by_user).toBe("U8")
    expect(hold.released_by_name).toBe("dan")
    expect(typeof hold.released_at_ms).toBe("number")
  })

  it("emits order_fulfillment_hold (not ops_alert_ack) on a hold", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    const calls = signedFetchCapture()
    const rawBody = orderRawBody(ORDER_HOLD_ACTION_ID, "order_01H")
    const ts = Math.floor(Date.now() / 1000)
    const { req } = makeOrderReq(rawBody, signedHeaders(rawBody, ts))
    const res = makeRes()
    await POST(req, res)
    await new Promise((r) => setTimeout(r, 0))

    const trackCall = calls.find((c) => c.url.endsWith("/v1/track"))
    expect(trackCall?.body.event).toBe("order_fulfillment_hold")
    expect(trackCall?.body.properties).toMatchObject({
      order_id: "order_01H",
      action: "hold",
    })
    // never the ack event
    expect(calls.some((c) => c.body?.event === "ops_alert_ack")).toBe(false)
  })

  it("does NOT call updateOrders when the order id does not resolve (no-op)", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "",
      GP_ANALYTICS_SERVER_KEY: "",
    }
    signedFetchCapture()
    const rawBody = orderRawBody(ORDER_HOLD_ACTION_ID, "order_missing")
    const ts = Math.floor(Date.now() / 1000)
    const { req, updateOrders } = makeOrderReq(rawBody, signedHeaders(rawBody, ts), {
      notFound: true, // graph returns []
    })
    const res = makeRes()
    await POST(req, res)
    await new Promise((r) => setTimeout(r, 0))

    expect(res.statusCode).toBe(200)
    expect(updateOrders).not.toHaveBeenCalled()
  })

  it("ROUTING: an ops_ack payload still hits the ack path and never calls updateOrders", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "https://ingestion.example.com",
      GP_ANALYTICS_SERVER_KEY: "k",
    }
    const calls = signedFetchCapture()
    const rawBody = ackRawBody("fp-route", { userId: "U7" })
    const ts = Math.floor(Date.now() / 1000)
    const { req, updateOrders } = makeOrderReq(rawBody, signedHeaders(rawBody, ts))
    const res = makeRes()
    await POST(req, res)
    await new Promise((r) => setTimeout(r, 0))

    // ack path: emits ops_alert_ack, never touches the order module
    const trackCall = calls.find((c) => c.url.endsWith("/v1/track"))
    expect(trackCall?.body.event).toBe("ops_alert_ack")
    expect(updateOrders).not.toHaveBeenCalled()
  })
})

describe("response_url SSRF guard", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  function makeReq(rawBody: string, headers: Record<string, unknown>) {
    return {
      rawBody,
      body: {},
      headers,
      scope: { resolve: () => ({ warn: jest.fn(), error: jest.fn() }) },
    } as any
  }

  // Drive a full ack click with the given response_url, then return every URL
  // fetch was called with so we can assert the response_url was/wasn't hit.
  async function fetchedUrlsForResponseUrl(responseUrl: string): Promise<string[]> {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      // No ingestion creds → emitOpsAlertAck no-ops, so the only fetch that can
      // happen is the response_url POST. That keeps this test focused on SSRF.
      GP_ANALYTICS_ENDPOINT: "",
      GP_ANALYTICS_SERVER_KEY: "",
    }
    const urls: string[] = []
    global.fetch = jest.fn(async (url: string) => {
      urls.push(String(url))
      return { ok: true } as any
    }) as any

    const rawBody = ackRawBody("fp-ssrf", { responseUrl })
    const ts = Math.floor(Date.now() / 1000)
    const res = makeRes()
    await POST(makeReq(rawBody, signedHeaders(rawBody, ts)), res)
    // Flush the fire-and-forget response_url post (not awaited by the handler).
    await new Promise((r) => setTimeout(r, 0))
    expect(res.statusCode).toBe(200)
    return urls
  }

  it("allows the canonical https://hooks.slack.com response_url", async () => {
    const urls = await fetchedUrlsForResponseUrl(
      "https://hooks.slack.com/actions/xyz"
    )
    expect(urls).toContain("https://hooks.slack.com/actions/xyz")
  })

  it("BLOCKS an attacker-registrable suffix host (evilslack.com)", async () => {
    const urls = await fetchedUrlsForResponseUrl("https://evilslack.com")
    expect(urls).not.toContain("https://evilslack.com")
    expect(urls.some((u) => u.includes("evilslack.com"))).toBe(false)
  })

  it("BLOCKS a hooks.slack.com prefix on an attacker domain", async () => {
    const urls = await fetchedUrlsForResponseUrl("https://hooks.slack.com.evil.com")
    expect(urls.some((u) => u.includes("evil.com"))).toBe(false)
  })

  it("BLOCKS a non-https (http) hooks.slack.com response_url", async () => {
    const urls = await fetchedUrlsForResponseUrl("http://hooks.slack.com/actions/xyz")
    expect(urls).not.toContain("http://hooks.slack.com/actions/xyz")
    expect(urls.some((u) => u.startsWith("http://"))).toBe(false)
  })

  it("sets redirect: manual on the response_url POST", async () => {
    process.env = {
      ...originalEnv,
      SLACK_SIGNING_SECRET: SIGNING_SECRET,
      GP_ANALYTICS_ENDPOINT: "",
      GP_ANALYTICS_SERVER_KEY: "",
    }
    const inits: any[] = []
    global.fetch = jest.fn(async (_url: string, init: any) => {
      inits.push(init)
      return { ok: true } as any
    }) as any
    const rawBody = ackRawBody("fp-redir", {
      responseUrl: "https://hooks.slack.com/actions/xyz",
    })
    const ts = Math.floor(Date.now() / 1000)
    const res = makeRes()
    await POST(makeReq(rawBody, signedHeaders(rawBody, ts)), res)
    await new Promise((r) => setTimeout(r, 0))
    expect(inits[0]?.redirect).toBe("manual")
  })
})
