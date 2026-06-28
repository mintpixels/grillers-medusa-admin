import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitSlackStaffAuthFailedAlert } from "../_shared/alerts"

// ───────────────────────── staff authorization ─────────────────────────
//
// "Who is staff" === the set of Medusa admin **users** — the people who can
// log into the Medusa admin (`/app`). That set lives in the core Medusa v2
// `user` module (entity `user`, unique on `email`). There is NO custom role
// table and NO Strapi user mirror in this project: the Strapi module is
// product-content only, and the only `user`/`invite` models are the core
// @medusajs/user ones. So the authoritative source is the query graph
// `user` entity, queried internally via the request container — no external
// HTTP, no GET /admin/users round-trip.
//
// Two authorization modes, chosen at runtime so flipping to the identity
// path is a config change, not a code change:
//
//  1. IDENTITY (preferred, matches intent): resolve the Slack caller's email
//     via Slack `users.info` (bot token; requires the `users:read.email`
//     OAuth scope), then check that email against the live staff-email set.
//     Active when SLACK_BOT_TOKEN is set AND the env allowlists are empty.
//
//  2. ALLOWLIST (fallback, no extra Slack scope needed): authorize by Slack
//     user_id / channel_id against SLACK_GP_ALLOWED_USER_IDS /
//     SLACK_GP_ALLOWED_CHANNEL_IDS. Used when the bot token is missing or
//     when an allowlist is explicitly configured. Lets the feature ship
//     before the `users:read.email` scope is added.

type Container = { resolve: (key: string) => any }

export type AuthResult =
  | { ok: true; mode: "identity" | "allowlist"; via: string }
  | { ok: false; reason: string }

const SLACK_USERS_INFO_URL = "https://slack.com/api/users.info"

// Brief in-process cache of the staff-email set. Slash commands are bursty and
// the staff set changes rarely; a short TTL keeps PII queries from hammering
// the DB without letting a removed staffer linger for long.
const STAFF_CACHE_TTL_MS = 60_000
let staffCache: { emails: Set<string>; expiresAt: number } | null = null

/** Reset the staff-email cache. Test-only / for explicit invalidation. */
export function __resetStaffCache(): void {
  staffCache = null
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : ""
}

/**
 * Load the current set of staff emails (lower-cased) from the Medusa `user`
 * module via the query graph. Cached for STAFF_CACHE_TTL_MS. Fails CLOSED:
 * if the lookup throws, callers treat the caller as non-staff.
 */
export async function getStaffEmails(
  scope: Container,
  opts?: { now?: number }
): Promise<Set<string>> {
  const now = opts?.now ?? Date.now()
  if (staffCache && staffCache.expiresAt > now) {
    return staffCache.emails
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "user",
    fields: ["email"],
  })

  const emails = new Set<string>()
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const email = normalizeEmail(row?.email)
    if (email) emails.add(email)
  }

  staffCache = { emails, expiresAt: now + STAFF_CACHE_TTL_MS }
  return emails
}

/**
 * Resolve a Slack user_id → email via Slack `users.info`. Requires a bot token
 * with the `users:read.email` scope. Returns "" on any failure (missing token,
 * Slack error, missing scope, no email) so the caller fails closed.
 */
export async function resolveSlackEmail(
  userId: string,
  opts?: { fetchImpl?: typeof fetch; logger?: any }
): Promise<string> {
  const token = process.env.SLACK_BOT_TOKEN || ""
  if (!token || !userId) return ""

  const doFetch = opts?.fetchImpl ?? fetch
  // Bound the call so a hung Slack API can't blow the slash-command's 3s window.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await doFetch(
      `${SLACK_USERS_INFO_URL}?user=${encodeURIComponent(userId)}`,
      { headers: { authorization: `Bearer ${token}` }, signal: controller.signal }
    )
    const body: any = await res.json()
    if (!body?.ok) {
      // `missing_scope` here means users:read.email isn't granted yet.
      opts?.logger?.warn?.(
        `[slack-command] users.info failed: ${body?.error || "unknown"}`
      )
      return ""
    }
    return normalizeEmail(body?.user?.profile?.email)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts?.logger?.warn?.(`[slack-command] users.info request error: ${message}`)
    return ""
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Authorize a Slack caller for the PII data subcommands (order/customer/stock).
 * Identity-based when a bot token is configured and no explicit allowlist is
 * set; allowlist-based otherwise. Fails CLOSED on any error.
 */
export async function authorizeStaffCaller(
  scope: Container,
  payload: { user_id: string; channel_id: string },
  opts?: { fetchImpl?: typeof fetch; logger?: any; now?: number }
): Promise<AuthResult> {
  const allowedUserIds = parseCsvEnv(process.env.SLACK_GP_ALLOWED_USER_IDS)
  const allowedChannelIds = parseCsvEnv(process.env.SLACK_GP_ALLOWED_CHANNEL_IDS)
  const hasAllowlist = allowedUserIds.length > 0 || allowedChannelIds.length > 0
  const hasBotToken = !!process.env.SLACK_BOT_TOKEN

  // Allowlist mode: explicit allowlist configured, OR no bot token available to
  // do identity resolution. If neither an allowlist nor a bot token is set, we
  // fail closed (nobody is authorized) rather than open up the PII lookups.
  if (hasAllowlist || !hasBotToken) {
    if (!hasAllowlist) {
      opts?.logger?.error?.(
        "[slack-command] no SLACK_BOT_TOKEN and no SLACK_GP_ALLOWED_* allowlist — denying all data subcommands"
      )
      await emitSlackStaffAuthFailedAlert({
        reason: "not_configured",
        stage: "authorization_config",
        logger: opts?.logger,
      })
      return { ok: false, reason: "not_configured" }
    }
    if (
      allowedChannelIds.length > 0 &&
      payload.channel_id &&
      allowedChannelIds.includes(payload.channel_id)
    ) {
      return { ok: true, mode: "allowlist", via: "channel" }
    }
    if (
      allowedUserIds.length > 0 &&
      payload.user_id &&
      allowedUserIds.includes(payload.user_id)
    ) {
      return { ok: true, mode: "allowlist", via: "user" }
    }
    return { ok: false, reason: "not_allowlisted" }
  }

  // Identity mode: resolve email via Slack, check against live staff set.
  const email = await resolveSlackEmail(payload.user_id, {
    fetchImpl: opts?.fetchImpl,
    logger: opts?.logger,
  })
  if (!email) {
    await emitSlackStaffAuthFailedAlert({
      reason: "email_unresolved",
      stage: "resolve_slack_email",
      logger: opts?.logger,
    })
    return { ok: false, reason: "email_unresolved" }
  }

  let staffEmails: Set<string>
  try {
    staffEmails = await getStaffEmails(scope, { now: opts?.now })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts?.logger?.warn?.(
      `[slack-command] staff-email lookup failed: ${message}`
    )
    await emitSlackStaffAuthFailedAlert({
      reason: "staff_lookup_failed",
      stage: "load_staff_emails",
      error,
      logger: opts?.logger,
    })
    return { ok: false, reason: "staff_lookup_failed" }
  }

  if (staffEmails.has(email)) {
    return { ok: true, mode: "identity", via: email }
  }
  return { ok: false, reason: "not_staff" }
}

/** Subcommands that expose PII / inventory and therefore require staff auth. */
const GATED_SUBCOMMANDS = new Set(["order", "customer", "stock"])

/** True when a subcommand must be authorized (help is open to everyone). */
export function requiresStaffAuth(subcommand: string): boolean {
  return GATED_SUBCOMMANDS.has(subcommand)
}
