import { createHmac, timingSafeEqual } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { authorizeStaffCaller, requiresStaffAuth } from "./staff-auth"

// Slack signs slash-command requests as:
//   X-Slack-Request-Timestamp: <unix seconds>
//   X-Slack-Signature: v0=<hex hmac-sha256(`v0:${timestamp}:${rawBody}`, signing_secret)>
// We verify over the EXACT raw urlencoded bytes (preserveRawBody) and reject
// anything older than 5 minutes to guard against replay.
const SIGNATURE_TOLERANCE_SECONDS = 300

const ADMIN_BASE_URL = (
  process.env.MEDUSA_ADMIN_URL ||
  process.env.MEDUSA_BACKEND_URL ||
  "https://grillers-medusa-admin-production.up.railway.app"
).replace(/\/+$/, "")

// ───────────────────────── raw body + headers ─────────────────────────

export function rawBodyString(req: Pick<MedusaRequest, "body"> & { rawBody?: unknown }): string {
  const raw = (req as any).rawBody
  if (typeof raw === "string") return raw
  if (raw && typeof raw.toString === "function") return raw.toString("utf8")
  // Fallback: re-serialize the parsed urlencoded body so dev (unsigned) works.
  // Signature verification only passes against this when no secret is set.
  const body = (req as any).body
  if (body && typeof body === "object") {
    return new URLSearchParams(body as Record<string, string>).toString()
  }
  return ""
}

function header(req: Pick<MedusaRequest, "headers">, name: string): string {
  const headers = (req.headers || {}) as any
  const value =
    headers[name] ??
    headers[name.toLowerCase()] ??
    (typeof headers.get === "function" ? headers.get(name) : undefined)
  // Node represents duplicate headers as a string[]; an attacker could send two
  // X-Slack-Signature headers to coerce an array into the constant-time compare.
  // Reject anything that isn't a single string by returning "".
  if (Array.isArray(value)) return ""
  return typeof value === "string" ? value : ""
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// ───────────────────────── signature verification ─────────────────────────

export type SlackVerifyResult = { ok: true } | { ok: false; reason: string }

/**
 * Verify the Slack signature over the raw request body. This is the ONLY gate
 * on this endpoint (the route lives outside /admin and /store so it bypasses
 * Medusa auth). Posture mirrors the Stripe webhook:
 *  - secret unset + NODE_ENV !== production  → accept (dev), log warning.
 *  - secret unset + production                → reject (never run open in prod).
 *  - secret set                               → strict HMAC + timestamp window.
 */
export function verifySlackSignature(
  req: Pick<MedusaRequest, "headers" | "body"> & { rawBody?: unknown },
  rawBody: string,
  opts?: { logger?: any; now?: number }
): SlackVerifyResult {
  const secret = process.env.SLACK_SIGNING_SECRET || ""
  if (!secret) {
    // Fail CLOSED on a missing secret by default. Accepting unsigned requests is
    // only allowed via an explicit dev opt-in (SLACK_ALLOW_UNSIGNED=true) AND
    // when not running production — we never key the open path on a single
    // NODE_ENV string match, so a misset/unset NODE_ENV can't silently open it.
    const explicitDevOptIn = process.env.SLACK_ALLOW_UNSIGNED === "true"
    const isProd = process.env.NODE_ENV === "production"
    if (explicitDevOptIn && !isProd) {
      opts?.logger?.warn?.(
        "[slack-command] SLACK_SIGNING_SECRET not set — accepting unsigned request (SLACK_ALLOW_UNSIGNED dev opt-in)"
      )
      return { ok: true }
    }
    opts?.logger?.error?.(
      "[slack-command] SLACK_SIGNING_SECRET not set — rejecting request"
    )
    return { ok: false, reason: "secret_not_configured" }
  }

  const signature = header(req, "x-slack-signature")
  const timestamp = header(req, "x-slack-request-timestamp")
  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_signature_headers" }
  }

  const tsNum = Number(timestamp)
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: "bad_timestamp" }
  }
  const nowSeconds = (opts?.now ?? Date.now()) / 1000
  if (Math.abs(nowSeconds - tsNum) > SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_range" }
  }

  const expected =
    "v0=" +
    createHmac("sha256", secret)
      .update(`v0:${timestamp}:${rawBody}`, "utf8")
      .digest("hex")

  if (!constantTimeEquals(signature, expected)) {
    return { ok: false, reason: "signature_mismatch" }
  }
  return { ok: true }
}

// ───────────────────────── payload parsing ─────────────────────────

export type SlackSlashPayload = {
  command: string
  text: string
  user_id: string
  user_name: string
  response_url: string
  channel_id: string
}

export function parseSlackPayload(rawBody: string): SlackSlashPayload {
  const params = new URLSearchParams(rawBody)
  return {
    command: params.get("command") || "",
    text: params.get("text") || "",
    user_id: params.get("user_id") || "",
    user_name: params.get("user_name") || "",
    response_url: params.get("response_url") || "",
    channel_id: params.get("channel_id") || "",
  }
}

export type ParsedCommand = {
  subcommand: string
  arg: string
}

/** Split the slash-command `text` into `<subcommand> <arg…>`. */
export function parseCommandText(text: string): ParsedCommand {
  const trimmed = (text || "").trim()
  if (!trimmed) return { subcommand: "help", arg: "" }
  const firstSpace = trimmed.indexOf(" ")
  if (firstSpace === -1) {
    return { subcommand: trimmed.toLowerCase(), arg: "" }
  }
  return {
    subcommand: trimmed.slice(0, firstSpace).toLowerCase(),
    arg: trimmed.slice(firstSpace + 1).trim(),
  }
}

// ───────────────────────── Slack message helpers ─────────────────────────

export type SlackMessage = {
  response_type: "ephemeral" | "in_channel"
  text: string
}

function ephemeral(text: string): SlackMessage {
  return { response_type: "ephemeral", text }
}

/**
 * Sanitize a user-supplied term before echoing it back into a Slack message.
 * We wrap echoed input in backticks; an attacker could close the code span and
 * inject `<http://evil|click me>` link/markdown. Strip the Slack mrkdwn control
 * characters (backtick, angle brackets, asterisk, underscore, pipe) and cap the
 * length so the echo stays inert and bounded.
 */
export function sanitizeEcho(term: unknown): string {
  const s = typeof term === "string" ? term : String(term ?? "")
  return s.replace(/[`<>*_|]/g, "").slice(0, 120)
}

const HELP_TEXT = [
  "*Grillers Pride `/gp` query bot*",
  "• `/gp order <display_id|order_id>` — status, total, customer, payment + fulfillment, items",
  "• `/gp customer <email|customer_id>` — order count, lifetime spend, last order",
  "• `/gp stock <handle|sku>` — variant inventory on hand",
  "• `/gp help` — this message",
].join("\n")

function helpMessage(): SlackMessage {
  return ephemeral(HELP_TEXT)
}

function formatMoney(amount: unknown, currency: unknown): string {
  const n = typeof amount === "number" ? amount : Number(amount)
  const cur = (typeof currency === "string" && currency ? currency : "usd").toUpperCase()
  if (!Number.isFinite(n)) return `—`
  return `${cur} ${n.toFixed(2)}`
}

function formatDate(value: unknown): string {
  if (!value) return "—"
  const d = new Date(value as any)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toISOString().slice(0, 10)
}

// ───────────────────────── data lookups ─────────────────────────
// All access is internal via the Medusa container (query graph + module
// services). No external HTTP. Every lookup is fail-soft: a thrown error is
// turned into a friendly Slack message by the caller (never a 500).

type Container = { resolve: (key: string) => any }

async function lookupOrder(scope: Container, arg: string): Promise<SlackMessage> {
  const term = (arg || "").trim()
  if (!term) {
    return ephemeral("Usage: `/gp order <display_id|order_id>`")
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const fields = [
    "id",
    "display_id",
    "email",
    "currency_code",
    "status",
    "payment_status",
    "fulfillment_status",
    "total",
    "customer_id",
    "customer.first_name",
    "customer.last_name",
    "customer.email",
    "items.id",
    "items.quantity",
  ]

  // Numeric arg → display_id; otherwise treat as the order id.
  const isNumeric = /^\d+$/.test(term)
  const filters = isNumeric ? { display_id: Number(term) } : { id: term }

  const { data } = await query.graph({ entity: "order", fields, filters })
  const order = (data || [])[0] as Record<string, any> | undefined
  if (!order?.id) {
    return ephemeral(`No order found for \`${sanitizeEcho(term)}\`.`)
  }

  const customerName =
    [order.customer?.first_name, order.customer?.last_name]
      .filter((p: unknown) => typeof p === "string" && p)
      .join(" ") ||
    order.customer?.email ||
    order.email ||
    "—"

  const itemCount = Array.isArray(order.items)
    ? order.items.reduce(
        (sum: number, it: any) => sum + (Number(it?.quantity) || 0),
        0
      )
    : 0

  const adminLink = `${ADMIN_BASE_URL}/app/orders/${order.id}`

  const lines = [
    `*Order #${order.display_id ?? "?"}* — <${adminLink}|open in admin>`,
    `• Status: \`${order.status || "—"}\``,
    `• Payment: \`${order.payment_status || "—"}\`  ·  Fulfillment: \`${order.fulfillment_status || "—"}\``,
    `• Total: ${formatMoney(order.total, order.currency_code)}`,
    `• Customer: ${customerName}`,
    `• Items: ${itemCount}`,
  ]
  return ephemeral(lines.join("\n"))
}

async function lookupCustomer(scope: Container, arg: string): Promise<SlackMessage> {
  const term = (arg || "").trim()
  if (!term) {
    return ephemeral("Usage: `/gp customer <email|customer_id>`")
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const looksLikeEmail = term.includes("@")
  const filters = looksLikeEmail
    ? { email: term.toLowerCase() }
    : { id: term }

  const { data } = await query.graph({
    entity: "customer",
    fields: ["id", "email", "first_name", "last_name"],
    filters,
  })
  const customer = (data || [])[0] as Record<string, any> | undefined
  if (!customer?.id) {
    return ephemeral(`No customer found for \`${sanitizeEcho(term)}\`.`)
  }

  // Aggregate orders for this customer. Indexed lookup by customer_id.
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "total", "currency_code", "created_at"],
    filters: { customer_id: customer.id },
  })

  const orderRows = (orders || []) as Record<string, any>[]
  const orderCount = orderRows.length
  const currency = orderRows[0]?.currency_code || "usd"
  const lifetime = orderRows.reduce(
    (sum, o) => sum + (Number(o?.total) || 0),
    0
  )
  const lastOrder = orderRows
    .map((o) => o?.created_at)
    .filter(Boolean)
    .sort()
    .pop()

  const name =
    [customer.first_name, customer.last_name]
      .filter((p: unknown) => typeof p === "string" && p)
      .join(" ") || customer.email

  const lines = [
    `*Customer:* ${name} (${customer.email || "—"})`,
    `• Orders: ${orderCount}`,
    `• Lifetime spend: ${formatMoney(lifetime, currency)}`,
    `• Last order: ${formatDate(lastOrder)}`,
  ]
  return ephemeral(lines.join("\n"))
}

async function lookupStock(scope: Container, arg: string): Promise<SlackMessage> {
  const term = (arg || "").trim()
  if (!term) {
    return ephemeral("Usage: `/gp stock <handle|sku>`")
  }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  // A `handle` belongs to the product; a `sku` belongs to a variant. Resolve
  // the matching variants either way, then compute on-hand per variant.
  const variantFields = [
    "id",
    "sku",
    "title",
    "manage_inventory",
    "allow_backorder",
    "+inventory_quantity",
    "product.title",
    "product.handle",
    "inventory_items.inventory.location_levels.stocked_quantity",
    "inventory_items.inventory.location_levels.reserved_quantity",
    "inventory_items.inventory.location_levels.available_quantity",
  ]

  // Try SKU first (exact), then product handle.
  let variants: Record<string, any>[] = []
  const bySku = await query.graph({
    entity: "product_variant",
    fields: variantFields,
    filters: { sku: term },
  })
  variants = (bySku.data || []) as Record<string, any>[]

  if (!variants.length) {
    const byHandle = await query.graph({
      entity: "product_variant",
      fields: variantFields,
      filters: { product: { handle: term } },
    })
    variants = (byHandle.data || []) as Record<string, any>[]
  }

  if (!variants.length) {
    return ephemeral(`No product/variant found for \`${sanitizeEcho(term)}\`.`)
  }

  const lines = [`*Stock for \`${sanitizeEcho(term)}\`*`]
  for (const v of variants.slice(0, 15)) {
    lines.push(`• ${describeVariantStock(v)}`)
  }
  if (variants.length > 15) {
    lines.push(`…and ${variants.length - 15} more variant(s).`)
  }
  return ephemeral(lines.join("\n"))
}

/** Human-readable on-hand summary for one variant, mirroring the allocator's logic. */
export function describeVariantStock(variant: Record<string, any>): string {
  const label =
    variant.sku ||
    [variant.product?.title, variant.title].filter(Boolean).join(" / ") ||
    variant.id

  if (variant.manage_inventory === false || variant.allow_backorder === true) {
    return `${label}: ∞ (not inventory-managed)`
  }

  const direct = Number(variant.inventory_quantity)
  if (Number.isFinite(direct)) {
    return `${label}: ${Math.max(0, Math.floor(direct))} on hand`
  }

  const links = Array.isArray(variant.inventory_items)
    ? variant.inventory_items
    : []
  let available = 0
  let sawLevels = false
  for (const link of links) {
    const levels = link?.inventory?.location_levels
    if (!Array.isArray(levels)) continue
    for (const level of levels) {
      sawLevels = true
      // Number(undefined) is NaN, not null/undefined, so `??` would never fall
      // through. Test finiteness explicitly before using available_quantity.
      const rawAvail = Number(level?.available_quantity)
      const avail = Number.isFinite(rawAvail)
        ? rawAvail
        : Math.max(
            0,
            (Number(level?.stocked_quantity) || 0) -
              (Number(level?.reserved_quantity) || 0)
          )
      available += Math.max(0, Number.isFinite(avail) ? avail : 0)
    }
  }
  if (sawLevels) {
    return `${label}: ${Math.max(0, Math.floor(available))} on hand`
  }
  return `${label}: unknown (no inventory levels)`
}

// ───────────────────────── dispatch ─────────────────────────

/**
 * Route a parsed command to the right lookup. Pure-ish: takes the resolved
 * container scope (so it is unit-testable with a mock scope). Fail-soft — a
 * thrown lookup error becomes a friendly Slack message, never a 500.
 */
export async function dispatchCommand(
  scope: Container,
  parsed: ParsedCommand,
  opts?: { logger?: any }
): Promise<SlackMessage> {
  try {
    switch (parsed.subcommand) {
      case "order":
        return await lookupOrder(scope, parsed.arg)
      case "customer":
        return await lookupCustomer(scope, parsed.arg)
      case "stock":
        return await lookupStock(scope, parsed.arg)
      case "help":
        return helpMessage()
      default:
        return helpMessage()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts?.logger?.warn?.(
      `[slack-command] lookup failed for ${parsed.subcommand}: ${message}`
    )
    return ephemeral(
      `Sorry — couldn't complete \`/gp ${sanitizeEcho(parsed.subcommand)}\`. ${
        parsed.arg ? `Check the value \`${sanitizeEcho(parsed.arg)}\` and try again.` : ""
      }`.trim()
    )
  }
}

// ───────────────────────── route handler ─────────────────────────

/**
 * Slack `/gp` slash-command endpoint.
 *
 * Slack app → Slash Commands → Request URL:
 *   https://grillers-medusa-admin-production.up.railway.app/webhooks/slack/command
 *
 * Secured ONLY by the Slack signing secret (route is outside /admin and /store
 * so it bypasses Medusa auth). preserveRawBody is registered for this path in
 * src/api/middlewares.ts so we have the exact urlencoded bytes for BOTH the HMAC
 * verification and the payload parse.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  let logger: any
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  const rawBody = rawBodyString(req)

  const verdict = verifySlackSignature(req, rawBody, { logger })
  if (!verdict.ok) {
    // Don't echo the specific failure reason to the (unauthenticated) caller —
    // it's minor reconnaissance leakage. Log it server-side, return a generic 401.
    logger?.warn?.(`[slack-command] rejected request: ${verdict.reason}`)
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  // Past the signature gate: NOTHING should surface a 500 to Slack (it renders
  // 500s as "dispatch_failed"). Wrap parse + dispatch so any unexpected throw
  // (e.g. a malformed body) still returns a friendly 200 ephemeral message.
  try {
    const payload = parseSlackPayload(rawBody)
    const parsed = parseCommandText(payload.text)

    // Authorization gate: the signature only proves the request came from the
    // Slack workspace, NOT that the CALLER is allowed to read customer PII.
    // Gate the data subcommands (order/customer/stock) to current Medusa staff;
    // `help` stays open to everyone (no PII). See staff-auth.ts for the source
    // of "who is staff" (the Medusa `user` module) and the identity/allowlist
    // modes.
    if (requiresStaffAuth(parsed.subcommand)) {
      const auth = await authorizeStaffCaller(
        req.scope,
        { user_id: payload.user_id, channel_id: payload.channel_id },
        { logger }
      )
      if (!auth.ok) {
        logger?.warn?.(
          `[slack-command] denied /gp ${parsed.subcommand} for user=${payload.user_id}: ${auth.reason}`
        )
        res.status(200).json({
          response_type: "ephemeral",
          text: "⛔ `/gp` is restricted to Grillers Pride staff.",
        })
        return
      }
    }

    // Respond within Slack's 3s window. These are all indexed lookups, so we do
    // a fast direct response rather than acking + posting to response_url.
    const message = await dispatchCommand(req.scope, parsed, { logger })
    res.status(200).json(message)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[slack-command] unexpected handler error: ${reason}`)
    res.status(200).json({
      response_type: "ephemeral",
      text: "Sorry — something went wrong handling that command. Try `/gp help`.",
    })
  }
}
