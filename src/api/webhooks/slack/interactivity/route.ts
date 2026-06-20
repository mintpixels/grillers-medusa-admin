import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlertAck } from "../_shared/emit-ack"
import { rawBodyString, verifySlackSignature } from "../_shared/verify"

// The action_id Slack sends when the on-call "✅ Ack" button is clicked. The
// ops-pager builds the button with this exact action_id; the button `value`
// carries the alert fingerprint.
export const OPS_ACK_ACTION_ID = "ops_ack"

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

// ───────────────────────── Slack message update ─────────────────────────

type FetchLike = typeof fetch
const RESPONSE_URL_TIMEOUT_MS = 2000

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

/**
 * POST the acked-confirmation back to Slack's response_url so the original
 * message updates in place. Fail-soft + timeout-bounded: a failure here never
 * fails the ack (the event is already emitted), it just leaves the original
 * message un-updated. Only http(s) Slack URLs are honored (SSRF guard).
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
  // else so a forged payload can't turn this into an SSRF primitive.
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith("slack.com")) {
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
 * On the "✅ Ack" button (action_id `ops_ack`, value = alert fingerprint) it
 * emits an `ops_alert_ack` event through the same ingestion path ops-alert.ts
 * uses; the ops-pager's escalation job reads those acks from ClickHouse and
 * stops re-paging the matching fingerprint. Fail-soft: always returns 200.
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
    const ack = extractAckAction(payload)

    if (!ack) {
      // Not an ops-ack interaction (different button, no fingerprint, or a
      // non-action payload like a url_verification). Ack with 200, do nothing.
      res.status(200).json({ ok: true, ignored: true })
      return
    }

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
    // Belt-and-suspenders: also push the same update to response_url, but do NOT
    // await it — it must never delay the 200 or extend past the Slack window.
    void postResponseUrl(payload?.response_url, ackedMessage, logger)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[slack-interactivity] unexpected handler error: ${reason}`)
    res.status(200).json({ ok: true })
  }
}
