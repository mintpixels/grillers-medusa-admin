import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../lib/ops-alert"
import {
  authorizeStaffCaller,
  getStaffEmails,
  resolveSlackEmail,
  requiresStaffAuth,
  __resetStaffCache,
} from "../staff-auth"

jest.mock("../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// ───────────────────────── helpers ─────────────────────────

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

/** A `fetch` stub that returns a Slack users.info-shaped JSON body. */
function fetchReturning(body: any): typeof fetch {
  return (async () => ({ json: async () => body })) as unknown as typeof fetch
}

const STAFF_GRAPH = () =>
  jest.fn(async ({ entity }: any) => {
    expect(entity).toBe("user")
    return {
      data: [
        { email: "Peter@grillerspride.com" }, // mixed case → normalized
        { email: "avi@grillerspride.com" },
      ],
    }
  })

// Snapshot + restore the env we mutate.
const ENV_KEYS = [
  "SLACK_BOT_TOKEN",
  "SLACK_GP_ALLOWED_USER_IDS",
  "SLACK_GP_ALLOWED_CHANNEL_IDS",
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  jest.clearAllMocks()
  saved = {}
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  for (const k of ENV_KEYS) delete process.env[k]
  __resetStaffCache()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  __resetStaffCache()
})

// ───────────────────────── requiresStaffAuth ─────────────────────────

describe("requiresStaffAuth", () => {
  it("gates the PII/inventory subcommands", () => {
    expect(requiresStaffAuth("order")).toBe(true)
    expect(requiresStaffAuth("customer")).toBe(true)
    expect(requiresStaffAuth("stock")).toBe(true)
  })
  it("leaves help (and unknowns) open", () => {
    expect(requiresStaffAuth("help")).toBe(false)
    expect(requiresStaffAuth("frobnicate")).toBe(false)
  })
})

// ───────────────────────── getStaffEmails ─────────────────────────

describe("getStaffEmails", () => {
  it("returns lower-cased staff emails from the user entity", async () => {
    const graph = STAFF_GRAPH()
    const { scope } = makeScope(graph)
    const set = await getStaffEmails(scope, { now: 1000 })
    expect(set.has("peter@grillerspride.com")).toBe(true)
    expect(set.has("avi@grillerspride.com")).toBe(true)
    expect(set.size).toBe(2)
  })

  it("caches within the TTL (single graph call) and refreshes after expiry", async () => {
    const graph = STAFF_GRAPH()
    const { scope } = makeScope(graph)
    await getStaffEmails(scope, { now: 1000 })
    await getStaffEmails(scope, { now: 1000 + 30_000 }) // within 60s TTL
    expect(graph).toHaveBeenCalledTimes(1)
    await getStaffEmails(scope, { now: 1000 + 61_000 }) // past TTL
    expect(graph).toHaveBeenCalledTimes(2)
  })
})

// ───────────────────────── resolveSlackEmail ─────────────────────────

describe("resolveSlackEmail", () => {
  it("returns '' when no bot token is set", async () => {
    delete process.env.SLACK_BOT_TOKEN
    const email = await resolveSlackEmail("U1", {
      fetchImpl: fetchReturning({ ok: true, user: { profile: { email: "x@y.com" } } }),
    })
    expect(email).toBe("")
  })

  it("resolves and lower-cases the email on a successful users.info", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const email = await resolveSlackEmail("U1", {
      fetchImpl: fetchReturning({
        ok: true,
        user: { profile: { email: "Peter@grillerspride.com" } },
      }),
    })
    expect(email).toBe("peter@grillerspride.com")
  })

  it("returns '' (and logs) when Slack reports missing_scope", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const logger = { warn: jest.fn() }
    const email = await resolveSlackEmail("U1", {
      fetchImpl: fetchReturning({ ok: false, error: "missing_scope" }),
      logger,
    })
    expect(email).toBe("")
    expect(logger.warn).toHaveBeenCalled()
  })

  it("returns '' when the fetch throws", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const throwingFetch = (async () => {
      throw new Error("network down")
    }) as unknown as typeof fetch
    const email = await resolveSlackEmail("U1", { fetchImpl: throwingFetch })
    expect(email).toBe("")
  })
})

// ───────────────────────── authorizeStaffCaller: identity mode ─────────────────────────

describe("authorizeStaffCaller — identity mode", () => {
  it("ALLOWS a caller whose Slack email is a current staff member", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const graph = STAFF_GRAPH()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(
      scope,
      { user_id: "U1", channel_id: "C1" },
      {
        now: 1000,
        fetchImpl: fetchReturning({
          ok: true,
          user: { profile: { email: "peter@grillerspride.com" } },
        }),
      }
    )
    expect(result.ok).toBe(true)
    expect(result.ok && result.mode).toBe("identity")
  })

  it("BLOCKS a caller whose Slack email is not a staff member", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const graph = STAFF_GRAPH()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(
      scope,
      { user_id: "U2", channel_id: "C1" },
      {
        now: 1000,
        fetchImpl: fetchReturning({
          ok: true,
          user: { profile: { email: "random@outside.com" } },
        }),
      }
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe("not_staff")
  })

  it("BLOCKS (fails closed) when the email cannot be resolved", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const graph = STAFF_GRAPH()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(
      scope,
      { user_id: "U3", channel_id: "C1" },
      { now: 1000, fetchImpl: fetchReturning({ ok: false, error: "missing_scope" }) }
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe("email_unresolved")
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "slack_staff_auth_failed",
        fingerprint: "slack_staff_auth_failed:email_unresolved",
        meta: expect.objectContaining({
          slack_command: "/gp",
          auth_reason: "email_unresolved",
          auth_stage: "resolve_slack_email",
        }),
      })
    )
  })

  it("BLOCKS (fails closed) when the staff lookup throws", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    const graph = jest.fn(async () => {
      throw new Error("db down")
    })
    const { scope, logger } = makeScope(graph)
    const result = await authorizeStaffCaller(
      scope,
      { user_id: "U1", channel_id: "C1" },
      {
        now: 1000,
        logger,
        fetchImpl: fetchReturning({
          ok: true,
          user: { profile: { email: "peter@grillerspride.com" } },
        }),
      }
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe("staff_lookup_failed")
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "slack_staff_auth_failed",
        fingerprint: "slack_staff_auth_failed:staff_lookup_failed",
        meta: expect.objectContaining({
          slack_command: "/gp",
          auth_reason: "staff_lookup_failed",
          auth_stage: "load_staff_emails",
          error_name: "Error",
        }),
      })
    )
  })
})

// ───────────────────────── authorizeStaffCaller: allowlist mode ─────────────────────────

describe("authorizeStaffCaller — allowlist fallback", () => {
  it("ALLOWS a user_id on SLACK_GP_ALLOWED_USER_IDS (no bot token)", async () => {
    process.env.SLACK_GP_ALLOWED_USER_IDS = "U1, U2 ,U3"
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(scope, { user_id: "U2", channel_id: "Cx" })
    expect(result.ok).toBe(true)
    expect(result.ok && result.mode).toBe("allowlist")
    expect(result.ok && result.via).toBe("user")
    expect(graph).not.toHaveBeenCalled() // no DB hit in pure-allowlist mode
  })

  it("ALLOWS a channel_id on SLACK_GP_ALLOWED_CHANNEL_IDS", async () => {
    process.env.SLACK_GP_ALLOWED_CHANNEL_IDS = "C_OPS"
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(scope, { user_id: "Uxxx", channel_id: "C_OPS" })
    expect(result.ok).toBe(true)
    expect(result.ok && result.via).toBe("channel")
  })

  it("BLOCKS a caller not on any allowlist", async () => {
    process.env.SLACK_GP_ALLOWED_USER_IDS = "U1"
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(scope, { user_id: "U999", channel_id: "C999" })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe("not_allowlisted")
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("prefers allowlist over identity when BOTH a token and an allowlist are set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test"
    process.env.SLACK_GP_ALLOWED_USER_IDS = "U1"
    const graph = jest.fn()
    const { scope } = makeScope(graph)
    const result = await authorizeStaffCaller(scope, { user_id: "U1", channel_id: "Cx" })
    expect(result.ok).toBe(true)
    expect(result.ok && result.mode).toBe("allowlist")
    expect(graph).not.toHaveBeenCalled()
  })

  it("BLOCKS everyone (fails closed) when neither bot token nor allowlist is configured", async () => {
    delete process.env.SLACK_BOT_TOKEN
    delete process.env.SLACK_GP_ALLOWED_USER_IDS
    delete process.env.SLACK_GP_ALLOWED_CHANNEL_IDS
    const graph = jest.fn()
    const { scope, logger } = makeScope(graph)
    const result = await authorizeStaffCaller(
      scope,
      { user_id: "U1", channel_id: "C1" },
      { logger }
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toBe("not_configured")
    expect(logger.error).toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "slack_staff_auth_failed",
        fingerprint: "slack_staff_auth_failed:not_configured",
        meta: expect.objectContaining({
          slack_command: "/gp",
          auth_reason: "not_configured",
          auth_stage: "authorization_config",
        }),
      })
    )
  })
})
