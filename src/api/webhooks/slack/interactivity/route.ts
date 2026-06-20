import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { metadataObject } from "../../../../lib/catch-weight-finalization"
import { emitOpsAlertAck } from "../_shared/emit-ack"
import { emitOrderFulfillmentHold } from "../_shared/emit-order-hold"
import { rawBodyString, verifySlackSignature } from "../_shared/verify"

// The action_id Slack sends when the on-call "✅ Ack" button is clicked. The
// ops-pager builds the button with this exact action_id; the button `value`
// carries the alert fingerprint.
export const OPS_ACK_ACTION_ID = "ops_ack"

// The action_ids Slack sends for the advisory approval-hold review card. The
// companion grillers-pride-analytics card builds two buttons with these exact
// action_ids; each button's `value` carries the order_id to hold / release.
export const ORDER_HOLD_ACTION_ID = "order_hold"
export const ORDER_RELEASE_ACTION_ID = "order_release"

// ───────────────────────── payload parsing ─────────────────────────

export type SlackInteractivityAction = {
  action_id?: string
  value?: string
}

export type SlackInteractivityPayload = {
  type?: string
  response_url?: string
  user?: { id?: string; username?: string; name?: string }
  actions?: SlackInteractivityAction[]
}

/**
 * Slack POSTs interactivity as `application/x-www-form-urlencoded` with a single
 * `payload` field holding the JSON. Pull it out of the raw body and parse it.
 * Returns null when the field is missing or the JSON is malformed (fail-soft).
 */
export function parseInteractivityPayload(
  rawBody: string
): SlackInteractivityPayload | null {
  const params = new URLSearchParams(rawBody)
  const payloadRaw = params.get("payload")
  if (!payloadRaw) return null
  try {
    const parsed = JSON.parse(payloadRaw)
    if (parsed && typeof parsed === "object") {
      return parsed as SlackInteractivityPayload
    }
    return null
  } catch {
    return null
  }
}

export type AckAction = {
  fingerprint: string
  ackedByUser: string
  ackedByName?: string
}

/**
 * Find the on-call Ack action in a parsed payload and extract the fingerprint +
 * acking user. Returns null when this interaction isn't an ops-ack (e.g. a
 * different button, or a fingerprint-less click), so the handler can ignore it.
 */
export function extractAckAction(
  payload: SlackInteractivityPayload | null
): AckAction | null {
  if (!payload || !Array.isArray(payload.actions)) return null
  const action = payload.actions.find(
    (a) => a?.action_id === OPS_ACK_ACTION_ID
  )
  if (!action) return null
  const fingerprint =
    typeof action.value === "string" ? action.value.trim() : ""
  if (!fingerprint) return null

  const user = payload.user || {}
  return {
    fingerprint,
    ackedByUser: typeof user.id === "string" ? user.id : "",
    ackedByName:
      (typeof user.username === "string" && user.username) ||
      (typeof user.name === "string" && user.name) ||
      undefined,
  }
}

export type OrderAction = {
  /** "hold" (action_id order_hold) or "release" (action_id order_release). */
  action: "hold" | "release"
  /** The order id carried in the button's `value`. */
  orderId: string
  /** Slack user id that clicked the button. */
  byUser: string
  /** Slack display name / username of the clicker, when present. */
  byName?: string
}

/**
 * Find the approval-hold Hold/Release action in a parsed payload and extract the
 * order id + clicking user. Returns null when this interaction isn't a hold or
 * release (e.g. an ops-ack click, a different button, or a value-less click), so
 * the handler can route it elsewhere or ignore it. Pure/deterministic.
 */
export function extractOrderAction(
  payload: SlackInteractivityPayload | null
): OrderAction | null {
  if (!payload || !Array.isArray(payload.actions)) return null
  const action = payload.actions.find(
    (a) =>
      a?.action_id === ORDER_HOLD_ACTION_ID ||
      a?.action_id === ORDER_RELEASE_ACTION_ID
  )
  if (!action) return null

  const orderId = typeof action.value === "string" ? action.value.trim() : ""
  if (!orderId) return null

  const user = payload.user || {}
  return {
    action: action.action_id === ORDER_HOLD_ACTION_ID ? "hold" : "release",
    orderId,
    byUser: typeof user.id === "string" ? user.id : "",
    byName:
      (typeof user.username === "string" && user.username) ||
      (typeof user.name === "string" && user.name) ||
      undefined,
  }
}

// ───────────────────────── Slack message update ─────────────────────────

type FetchLike = typeof fetch
const RESPONSE_URL_TIMEOUT_MS = 2000

// Slack's interactivity response_url is ALWAYS https://hooks.slack.com/actions/…
// Pin the exact host (not a suffix match — `endsWith("slack.com")` would let an
// attacker-registrable host like `evilslack.com` or `notslack.com` through).
// A Set keeps the allow-list explicit and trivially extensible.
const ALLOWED_RESPONSE_HOSTS = new Set(["hooks.slack.com"])

/**
 * Build the `replace_original` message body that overwrites the original page
 * with an acked confirmation. Pure/deterministic so it can be unit-tested.
 */
export function buildAckedMessage(ack: AckAction): Record<string, unknown> {
  const who = ack.ackedByUser ? `<@${ack.ackedByUser}>` : "someone"
  return {
    replace_original: true,
    response_type: "in_channel",
    text: `✅ Acked by ${who}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Acked by ${who}* — escalation stopped.`,
        },
      },
    ],
  }
}

// Slack mrkdwn reserves &, <, > for entities/links. A clicker's display name is
// untrusted text, so escape it before interpolating. When no name is present we
// fall back to a Slack user-mention (`<@Uxxx>`), which Slack renders as the name.
function escapeSlackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/**
 * Build the `replace_original` message that overwrites the review card after a
 * Hold or Release click. Pure/deterministic so it can be unit-tested. Prefers the
 * clicker's (escaped) display name, else a Slack user-mention.
 */
export function buildOrderHoldMessage(input: {
  action: "hold" | "release"
  byName?: string
  byUser: string
}): Record<string, unknown> {
  const who = input.byName
    ? escapeSlackText(input.byName)
    : input.byUser
    ? `<@${input.byUser}>`
    : "someone"

  if (input.action === "hold") {
    return {
      replace_original: true,
      response_type: "in_channel",
      text: `⏸️ Held by ${who} — fulfillment blocked.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:double_vertical_bar: *Held by ${who}* — fulfillment blocked.`,
          },
        },
      ],
    }
  }

  return {
    replace_original: true,
    response_type: "in_channel",
    text: `✅ Released by ${who}.`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Released by ${who}.*`,
        },
      },
    ],
  }
}

/**
 * POST the acked-confirmation back to Slack's response_url so the original
 * message updates in place. Fail-soft + timeout-bounded: a failure here never
 * fails the ack (the event is already emitted), it just leaves the original
 * message un-updated. SSRF guard: only an https URL whose host is exactly
 * `hooks.slack.com` is honored, and redirects are not followed.
 */
async function postResponseUrl(
  responseUrl: string | undefined,
  message: Record<string, unknown>,
  logger: any,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (!responseUrl) return
  let parsed: URL
  try {
    parsed = new URL(responseUrl)
  } catch {
    return
  }
  // Slack response_urls are always https://hooks.slack.com/… — refuse anything
  // else (exact host pin, not a suffix match) so a forged payload can't turn
  // this into an SSRF primitive.
  if (parsed.protocol !== "https:" || !ALLOWED_RESPONSE_HOSTS.has(parsed.hostname)) {
    logger?.warn?.(
      `[slack-interactivity] refusing non-Slack response_url host ${parsed.hostname}`
    )
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RESPONSE_URL_TIMEOUT_MS)
  try {
    await fetchImpl(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: controller.signal,
      // Don't follow redirects (undici follows by default): a 3xx from the
      // pinned host must not bounce this POST to an internal/other host.
      redirect: "manual",
    })
  } catch (error) {
    logger?.warn?.(
      `[slack-interactivity] response_url update failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  } finally {
    clearTimeout(timeout)
  }
}

// ───────────────────────── order hold/release apply ─────────────────────────

export type ApplyOrderHoldResult =
  /** The order was found and its metadata.fulfillment_hold was written. */
  | { applied: true; found: true }
  /** No order resolved for this id — nothing was written (conservative no-op). */
  | { applied: false; found: false }

/**
 * Apply a Hold or Release to an order's metadata.
 *
 * Hold sets `metadata.fulfillment_hold = { held:true, held_by_*, held_at_ms,
 * reason }`. Release flips `held:false` on the EXISTING hold object (preserving
 * the `held_by_*` / `held_at_ms` / `reason` audit trail) and appends
 * `released_by_*` / `released_at_ms`, so the full who-held-then-released trail
 * survives.
 *
 * If the order id doesn't resolve, this does NOT call updateOrders — it returns
 * `{ applied:false, found:false }` so the handler can 200 gracefully without
 * mutating a non-existent order (the conservative path; a bogus order_id in a
 * forged-but-signed payload should be a no-op, not a write).
 *
 * Throws only on a genuine query/update failure; the POST handler's try/catch
 * turns that into a fail-soft 200 to Slack.
 */
export async function applyOrderHold(
  req: MedusaRequest,
  action: OrderAction,
  logger: any
): Promise<ApplyOrderHoldResult> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "metadata"],
    filters: { id: action.orderId },
  })
  const order = data?.[0]

  if (!order) {
    // Conservative: never updateOrders for an id that doesn't resolve.
    logger?.warn?.(
      `[slack-interactivity] ${action.action} requested for unknown order ${action.orderId}; no-op`
    )
    return { applied: false, found: false }
  }

  const metadata = metadataObject(order.metadata)
  const now = Date.now()

  if (action.action === "hold") {
    metadata.fulfillment_hold = {
      held: true,
      held_by_user: action.byUser,
      held_by_name: action.byName ?? null,
      held_at_ms: now,
      reason: "slack_review",
    }
  } else {
    // Release: keep the existing hold's audit fields, flip held=false, and add
    // the release trail. metadataObject already returned a fresh object, but
    // fulfillment_hold may be a nested reference — spread it to avoid mutating
    // the source.
    const existingHold =
      metadata.fulfillment_hold && typeof metadata.fulfillment_hold === "object"
        ? metadata.fulfillment_hold
        : {}
    metadata.fulfillment_hold = {
      ...existingHold,
      held: false,
      released_by_user: action.byUser,
      released_by_name: action.byName ?? null,
      released_at_ms: now,
    }
  }

  const orderModule = req.scope.resolve(Modules.ORDER)
  await orderModule.updateOrders(action.orderId, { metadata })

  return { applied: true, found: true }
}

// ───────────────────────── route handler ─────────────────────────

/**
 * Slack interactivity endpoint (on-call Ack).
 *
 * Slack app → Interactivity & Shortcuts → Request URL:
 *   https://grillers-medusa-admin-production.up.railway.app/webhooks/slack/interactivity
 *
 * Secured ONLY by the Slack signing secret (route is outside /admin and /store
 * so it bypasses Medusa auth). preserveRawBody is registered for this path in
 * src/api/middlewares.ts so we have the exact urlencoded bytes for the HMAC.
 *
 * Routes by action_id:
 *  - "✅ Ack" (action_id `ops_ack`, value = alert fingerprint) → emit an
 *    `ops_alert_ack` event; the ops-pager's escalation job reads those acks from
 *    ClickHouse and stops re-paging the matching fingerprint.
 *  - "⏸️ Hold" / "✅ Release" (action_id `order_hold` / `order_release`, value =
 *    order_id) → set/clear `order.metadata.fulfillment_hold.held` and emit an
 *    `order_fulfillment_hold` / `order_fulfillment_release` audit event. The
 *    fulfillment middleware in src/api/middlewares.ts blocks fulfillment only
 *    while `held === true` (advisory by design — nothing is auto-held).
 *
 * Fail-soft: always returns 200 past the signature gate.
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
    // Don't echo the specific failure reason to the (unauthenticated) caller.
    logger?.warn?.(`[slack-interactivity] rejected request: ${verdict.reason}`)
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  // Past the signature gate: NEVER surface a 500 to Slack. Any throw becomes a
  // friendly 200 so Slack doesn't render an error or retry-storm the endpoint.
  try {
    const payload = parseInteractivityPayload(rawBody)

    // Route by action_id. Order matters only for clarity (a single payload
    // carries exactly one of these): ops-ack first (unchanged), then the
    // approval-hold Hold/Release, else ignore.
    const ack = extractAckAction(payload)
    if (ack) {
      // Emit the ack event — the durable signal the ops-pager reads. AWAIT this
      // (it's the whole point of the click); it is timeout-bounded (2.5s) and
      // fail-soft. The cosmetic message update is NOT awaited so total latency
      // stays well under Slack's ~3s interactivity window.
      const result = await emitOpsAlertAck({
        fingerprint: ack.fingerprint,
        ackedByUser: ack.ackedByUser,
        ackedByName: ack.ackedByName,
        logger,
      })
      if (!result.ok) {
        logger?.warn?.(
          `[slack-interactivity] ops_alert_ack emit did not land for ${ack.fingerprint} (skipped=${result.skipped})`
        )
      }

      const ackedMessage = buildAckedMessage(ack)
      // Respond 200 with the replacement message: Slack uses the response body
      // (replace_original: true) to update the original page in place.
      res.status(200).json(ackedMessage)
      // Belt-and-suspenders: also push the same update to response_url, but do
      // NOT await it — it must never delay the 200 or extend past the window.
      void postResponseUrl(payload?.response_url, ackedMessage, logger)
      return
    }

    const orderAction = extractOrderAction(payload)
    if (orderAction) {
      // The point of the click: write the hold/release to order metadata. AWAIT
      // it — if the order id doesn't resolve, applyOrderHold no-ops (no write).
      const applyResult = await applyOrderHold(req, orderAction, logger)

      // Emit the audit event (who held/released which order). AWAIT it
      // (timeout-bounded, fail-soft) so a dropped event is at least logged.
      const emitResult = await emitOrderFulfillmentHold({
        orderId: orderAction.orderId,
        action: orderAction.action,
        byUser: orderAction.byUser,
        byName: orderAction.byName,
        logger,
      })
      if (!emitResult.ok) {
        logger?.warn?.(
          `[slack-interactivity] order_fulfillment_${orderAction.action} emit did not land for ${orderAction.orderId} (skipped=${emitResult.skipped})`
        )
      }

      // Conservative path: even when the order id didn't resolve (no metadata
      // write happened), echo the action back to Slack and let the audit event
      // record the attempt. applyOrderHold already logged the not-found case.
      if (!applyResult.found) {
        logger?.warn?.(
          `[slack-interactivity] order_${orderAction.action} for ${orderAction.orderId} was a no-op (order not found)`
        )
      }

      const message = buildOrderHoldMessage({
        action: orderAction.action,
        byName: orderAction.byName,
        byUser: orderAction.byUser,
      })
      // Respond 200 with the replacement card (replace_original) — harmless even
      // on the not-found no-op.
      res.status(200).json(message)
      void postResponseUrl(payload?.response_url, message, logger)
      return
    }

    // Not an ops-ack or approval-hold interaction (different button, no value,
    // or a non-action payload like a url_verification). Ack with 200, do nothing.
    res.status(200).json({ ok: true, ignored: true })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[slack-interactivity] unexpected handler error: ${reason}`)
    res.status(200).json({ ok: true })
  }
}
