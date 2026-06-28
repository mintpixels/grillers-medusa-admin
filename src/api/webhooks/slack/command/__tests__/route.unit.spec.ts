import { createHmac } from "node:crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../lib/ops-alert"
import {
  verifySlackSignature,
  parseSlackPayload,
  parseCommandText,
  dispatchCommand,
  describeVariantStock,
  sanitizeEcho,
} from "../route"

jest.mock("../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

const SECRET = "test_signing_secret_abc123"

beforeEach(() => {
  ;(emitOpsAlert as jest.Mock).mockClear()
})

function sign(rawBody: string, timestamp: number): string {
  return (
    "v0=" +
    createHmac("sha256", SECRET)
      .update(`v0:${timestamp}:${rawBody}`, "utf8")
      .digest("hex")
  )
}

function makeReq(opts: {
  rawBody: string
  signature?: string
  timestamp?: string
}) {
  const headers: Record<string, string> = {}
  if (opts.signature !== undefined) headers["x-slack-signature"] = opts.signature
  if (opts.timestamp !== undefined)
    headers["x-slack-request-timestamp"] = opts.timestamp
  return { headers, rawBody: opts.rawBody, body: {} }
}

describe("slack /gp — signature verification", () => {
  const NOW_MS = 1_700_000_000_000 // fixed clock
  const NOW_S = Math.floor(NOW_MS / 1000)
  const RAW = "command=%2Fgp&text=help&user_id=U1"

  const origEnv = process.env.SLACK_SIGNING_SECRET
  const origNodeEnv = process.env.NODE_ENV
  const origAllowUnsigned = process.env.SLACK_ALLOW_UNSIGNED

  afterEach(() => {
    if (origEnv === undefined) delete process.env.SLACK_SIGNING_SECRET
    else process.env.SLACK_SIGNING_SECRET = origEnv
    if (origNodeEnv === undefined) delete (process.env as any).NODE_ENV
    else process.env.NODE_ENV = origNodeEnv
    if (origAllowUnsigned === undefined) delete process.env.SLACK_ALLOW_UNSIGNED
    else process.env.SLACK_ALLOW_UNSIGNED = origAllowUnsigned
  })

  it("accepts a valid signature within the time window", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const req = makeReq({
      rawBody: RAW,
      timestamp: String(NOW_S),
      signature: sign(RAW, NOW_S),
    })
    expect(verifySlackSignature(req, RAW, { now: NOW_MS }).ok).toBe(true)
  })

  it("rejects a tampered/bad signature", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const req = makeReq({
      rawBody: RAW,
      timestamp: String(NOW_S),
      signature: "v0=deadbeef",
    })
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("signature_mismatch")
  })

  it("rejects a signature for a different body (HMAC over wrong bytes)", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const req = makeReq({
      rawBody: RAW,
      timestamp: String(NOW_S),
      signature: sign("command=%2Fgp&text=order+42", NOW_S), // signed a different body
    })
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
  })

  it("rejects an old timestamp (replay guard, >5 min)", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const oldTs = NOW_S - 6 * 60 // 6 minutes old
    const req = makeReq({
      rawBody: RAW,
      timestamp: String(oldTs),
      signature: sign(RAW, oldTs),
    })
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("timestamp_out_of_range")
  })

  it("rejects missing signature/timestamp headers", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const req = makeReq({ rawBody: RAW })
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("missing_signature_headers")
  })

  it("rejects when the secret is unset in production", () => {
    delete process.env.SLACK_SIGNING_SECRET
    process.env.NODE_ENV = "production"
    const req = makeReq({ rawBody: RAW })
    const logger = { error: jest.fn(), warn: jest.fn() }
    const result = verifySlackSignature(req, RAW, { now: NOW_MS, logger })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("secret_not_configured")
    expect(logger.error).toHaveBeenCalled()
  })

  it("fails CLOSED when secret unset and NODE_ENV is unset (no silent open)", () => {
    delete process.env.SLACK_SIGNING_SECRET
    delete (process.env as any).NODE_ENV
    delete process.env.SLACK_ALLOW_UNSIGNED
    const req = makeReq({ rawBody: RAW })
    const logger = { error: jest.fn(), warn: jest.fn() }
    const result = verifySlackSignature(req, RAW, { now: NOW_MS, logger })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("secret_not_configured")
  })

  it("does NOT accept unsigned even with the dev opt-in when NODE_ENV=production", () => {
    delete process.env.SLACK_SIGNING_SECRET
    process.env.NODE_ENV = "production"
    process.env.SLACK_ALLOW_UNSIGNED = "true"
    const req = makeReq({ rawBody: RAW })
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
  })

  it("accepts unsigned ONLY with explicit dev opt-in (SLACK_ALLOW_UNSIGNED=true, non-prod)", () => {
    delete process.env.SLACK_SIGNING_SECRET
    process.env.NODE_ENV = "development"
    process.env.SLACK_ALLOW_UNSIGNED = "true"
    const req = makeReq({ rawBody: RAW })
    const logger = { error: jest.fn(), warn: jest.fn() }
    const result = verifySlackSignature(req, RAW, { now: NOW_MS, logger })
    expect(result.ok).toBe(true)
    expect(logger.warn).toHaveBeenCalled()
  })

  it("rejects a duplicate (array) signature header instead of coercing it", () => {
    process.env.SLACK_SIGNING_SECRET = SECRET
    const req: any = {
      headers: {
        "x-slack-signature": [sign(RAW, NOW_S), "v0=deadbeef"],
        "x-slack-request-timestamp": String(NOW_S),
      },
      rawBody: RAW,
      body: {},
    }
    const result = verifySlackSignature(req, RAW, { now: NOW_MS })
    expect(result.ok).toBe(false)
    expect(result.ok ? "" : result.reason).toBe("missing_signature_headers")
  })
})

describe("slack /gp — payload + command parsing", () => {
  it("parses the urlencoded slash payload", () => {
    const raw =
      "command=%2Fgp&text=order+1042&user_id=U123&user_name=peter&response_url=https%3A%2F%2Fhooks.slack.com%2Fx&channel_id=C1"
    const p = parseSlackPayload(raw)
    expect(p.command).toBe("/gp")
    expect(p.text).toBe("order 1042")
    expect(p.user_id).toBe("U123")
    expect(p.user_name).toBe("peter")
    expect(p.response_url).toBe("https://hooks.slack.com/x")
    expect(p.channel_id).toBe("C1")
  })

  it("splits subcommand and arg", () => {
    expect(parseCommandText("order 1042")).toEqual({
      subcommand: "order",
      arg: "1042",
    })
    expect(parseCommandText("customer  jane@example.com")).toEqual({
      subcommand: "customer",
      arg: "jane@example.com",
    })
    expect(parseCommandText("stock brisket-whole")).toEqual({
      subcommand: "stock",
      arg: "brisket-whole",
    })
    expect(parseCommandText("help")).toEqual({ subcommand: "help", arg: "" })
  })

  it("treats empty text as help", () => {
    expect(parseCommandText("")).toEqual({ subcommand: "help", arg: "" })
    expect(parseCommandText("   ")).toEqual({ subcommand: "help", arg: "" })
  })
})

describe("slack /gp — dispatch", () => {
  function makeScope(graph: jest.Mock) {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    return {
      scope: {
        resolve: (key: string) => {
          if (key === ContainerRegistrationKeys.QUERY) return { graph }
          if (key === ContainerRegistrationKeys.LOGGER) return logger
          throw new Error(`Unknown dependency ${key}`)
        },
      },
      logger,
    }
  }

  it("order → status/total/customer/fulfillment, by display_id", async () => {
    const graph = jest.fn(async ({ entity, filters }: any) => {
      expect(entity).toBe("order")
      expect(filters).toEqual({ display_id: 1042 })
      return {
        data: [
          {
            id: "order_1",
            display_id: 1042,
            email: "jane@example.com",
            currency_code: "usd",
            status: "completed",
            payment_status: "captured",
            fulfillment_status: "shipped",
            total: 123.45,
            customer: { first_name: "Jane", last_name: "Doe" },
            items: [{ id: "li_1", quantity: 2 }, { id: "li_2", quantity: 1 }],
          },
        ],
      }
    })
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, { subcommand: "order", arg: "1042" })
    expect(msg.response_type).toBe("ephemeral")
    expect(msg.text).toContain("Order #1042")
    expect(msg.text).toContain("captured")
    expect(msg.text).toContain("shipped")
    expect(msg.text).toContain("USD 123.45")
    expect(msg.text).toContain("Jane Doe")
    expect(msg.text).toContain("Items: 3")
    expect(msg.text).toContain("/app/orders/order_1")
  })

  it("order → uses id filter for a non-numeric arg", async () => {
    const graph = jest.fn(async ({ filters }: any) => {
      expect(filters).toEqual({ id: "order_abc" })
      return { data: [] }
    })
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, {
      subcommand: "order",
      arg: "order_abc",
    })
    expect(msg.text).toContain("No order found")
  })

  it("customer → order count, lifetime spend, last order", async () => {
    const graph = jest.fn(async ({ entity, filters }: any) => {
      if (entity === "customer") {
        expect(filters).toEqual({ email: "jane@example.com" })
        return {
          data: [
            {
              id: "cus_1",
              email: "jane@example.com",
              first_name: "Jane",
              last_name: "Doe",
            },
          ],
        }
      }
      // order aggregation
      expect(entity).toBe("order")
      expect(filters).toEqual({ customer_id: "cus_1" })
      return {
        data: [
          { id: "o1", total: 50, currency_code: "usd", created_at: "2026-01-01" },
          { id: "o2", total: 75, currency_code: "usd", created_at: "2026-03-15" },
        ],
      }
    })
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, {
      subcommand: "customer",
      arg: "jane@example.com",
    })
    expect(msg.text).toContain("Jane Doe")
    expect(msg.text).toContain("Orders: 2")
    expect(msg.text).toContain("USD 125.00")
    expect(msg.text).toContain("2026-03-15")
  })

  it("stock → variant inventory on hand", async () => {
    const graph = jest.fn(async ({ filters }: any) => {
      // first call filters by sku
      if (filters.sku) {
        return {
          data: [
            {
              id: "variant_1",
              sku: "BRISKET-1",
              title: "Whole",
              manage_inventory: true,
              inventory_quantity: 7,
              product: { title: "Brisket", handle: "brisket" },
            },
          ],
        }
      }
      return { data: [] }
    })
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, {
      subcommand: "stock",
      arg: "BRISKET-1",
    })
    expect(msg.text).toContain("BRISKET-1")
    expect(msg.text).toContain("7 on hand")
  })

  it("help → lists the commands", async () => {
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, { subcommand: "help", arg: "" })
    expect(msg.text).toContain("/gp order")
    expect(msg.text).toContain("/gp customer")
    expect(msg.text).toContain("/gp stock")
    expect(graph).not.toHaveBeenCalled()
  })

  it("unknown subcommand → falls back to help", async () => {
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const msg = await dispatchCommand(scope, { subcommand: "frobnicate", arg: "x" })
    expect(msg.text).toContain("/gp order")
    expect(graph).not.toHaveBeenCalled()
  })

  it("fail-soft: a thrown lookup error returns a friendly message (never throws)", async () => {
    const graph = jest.fn(async () => {
      throw new Error("db exploded")
    })
    const { scope, logger } = makeScope(graph)
    const msg = await dispatchCommand(scope, { subcommand: "order", arg: "1042" }, {
      logger,
    })
    expect(msg.response_type).toBe("ephemeral")
    expect(msg.text.toLowerCase()).toContain("couldn't complete")
    expect(logger.warn).toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "slack_command_lookup_failed",
        fingerprint: "slack_command_lookup_failed:order",
        path: "/webhooks/slack/command",
        severity: "warn",
        meta: expect.objectContaining({
          slack_command: "/gp",
          slack_subcommand: "order",
          has_argument: true,
          error_name: "Error",
        }),
      })
    )
    expect(
      (emitOpsAlert as jest.Mock).mock.calls[0][0].meta.error_message_hash
    ).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe("sanitizeEcho — markdown-injection guard", () => {
  it("strips Slack mrkdwn control chars from echoed input", () => {
    // Attempt to break out of the backtick code span and inject a link.
    const evil = "x` <http://evil|click> *bold* _it_ |pipe`"
    const out = sanitizeEcho(evil)
    expect(out).not.toMatch(/[`<>*_|]/)
    expect(out).toBe("x http://evilclick bold it pipe")
  })

  it("caps length and coerces non-strings", () => {
    expect(sanitizeEcho("a".repeat(500)).length).toBe(120)
    expect(sanitizeEcho(undefined)).toBe("")
    expect(sanitizeEcho(1234 as any)).toBe("1234")
  })

  it("echoes a benign term unchanged", () => {
    expect(sanitizeEcho("brisket-whole")).toBe("brisket-whole")
    expect(sanitizeEcho("jane@example.com")).toBe("jane@example.com")
  })
})

describe("dispatch — echoed terms are sanitized", () => {
  function makeScope(graph: jest.Mock) {
    return {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.QUERY) return { graph }
        throw new Error(`Unknown dependency ${key}`)
      },
    }
  }

  it("a not-found order echoes a sanitized term (no raw backticks/angle brackets)", async () => {
    const graph = jest.fn(async () => ({ data: [] }))
    const scope = makeScope(graph)
    const msg = await dispatchCommand(scope, {
      subcommand: "order",
      arg: "abc`<http://evil|x>",
    })
    expect(msg.text).not.toContain("<http://evil")
    expect(msg.text).toContain("No order found")
  })
})

describe("describeVariantStock", () => {
  it("reports infinite for non-managed inventory", () => {
    expect(
      describeVariantStock({ sku: "X", manage_inventory: false })
    ).toContain("∞")
  })
  it("uses direct inventory_quantity when present", () => {
    expect(
      describeVariantStock({ sku: "X", manage_inventory: true, inventory_quantity: 12 })
    ).toContain("12 on hand")
  })
  it("sums location levels when no direct quantity", () => {
    const out = describeVariantStock({
      sku: "X",
      manage_inventory: true,
      inventory_items: [
        {
          inventory: {
            location_levels: [
              { stocked_quantity: 10, reserved_quantity: 3 },
              { stocked_quantity: 5, reserved_quantity: 0 },
            ],
          },
        },
      ],
    })
    expect(out).toContain("on hand")
  })
})
