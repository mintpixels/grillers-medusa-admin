import { randomUUID } from "node:crypto"
import type { Logger } from "@medusajs/framework/types"

// Reuses the EXACT ingestion contract that src/lib/ops-alert.ts uses
// (POST {GP_ANALYTICS_ENDPOINT}/v1/track, Bearer GP_ANALYTICS_SERVER_KEY,
// event under top-level `event`, payload under `properties`) — the same path
// the ops-pager polls from grillers_pride.events. The only difference is the
// event name: `ops_alert_ack` instead of `ops_alert`, so the pager's
// escalation job can correlate acks to pages by fingerprint.
//
// ACK_TIMEOUT_MS keeps this bounded: an ack must never hold Slack's ~3s
// interactivity response window. We AWAIT (so a dropped ack is at least visible
// in Railway logs) but abort fast and fail-soft.
const ACK_TIMEOUT_MS = 2500

export type OpsAlertAckInput = {
  /** The alert fingerprint carried in the Ack button's `value`. */
  fingerprint: string
  /** Slack user id that clicked Ack (e.g. "U12345"). */
  ackedByUser: string
  /** Slack display name / username of the acker, when present. */
  ackedByName?: string
  /** Coarse alert classification, when the button carried it. */
  alertKind?: string
  logger?: Pick<Logger, "warn" | "error">
}

export type OpsAlertAckResult =
  | { ok: true; skipped: false }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false }

/**
 * Emit an `ops_alert_ack` event to the gp-analytics ingestion API. No-op (logs)
 * when GP_ANALYTICS_ENDPOINT/GP_ANALYTICS_SERVER_KEY are unset. Fail-soft: any
 * non-2xx or thrown error is logged and swallowed so the interactivity handler
 * always returns 200 to Slack.
 */
export async function emitOpsAlertAck(
  input: OpsAlertAckInput
): Promise<OpsAlertAckResult> {
  const endpoint = process.env.GP_ANALYTICS_ENDPOINT?.replace(/\/+$/, "")
  const serverKey = process.env.GP_ANALYTICS_SERVER_KEY

  if (!endpoint || !serverKey) {
    input.logger?.warn?.(
      `[ops-alert-ack] skipped ${input.fingerprint}: GP_ANALYTICS_ENDPOINT/GP_ANALYTICS_SERVER_KEY missing`
    )
    return { ok: false, skipped: true }
  }

  const now = Date.now()
  const body = {
    event: "ops_alert_ack",
    event_id: randomUUID(),
    event_timestamp_ms: now,
    session_id: randomUUID(),
    anonymous_id: randomUUID(),
    experience_version: "medusa",
    route_market: "national",
    customer_type: "dtc",
    source: "medusa-server",
    properties: {
      fingerprint: input.fingerprint,
      acked_by_user: input.ackedByUser,
      acked_by_name: input.ackedByName ?? null,
      alert_kind: input.alertKind ?? null,
      acked_at_ms: now,
      release: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      env: process.env.NODE_ENV ?? "production",
    },
    context: {
      library: {
        name: "grillers-medusa-admin-ops-alert-ack",
        version: "0.1.0",
      },
    },
  }

  const url = `${endpoint}/v1/track`
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serverKey}`,
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ACK_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!response.ok) {
      const text =
        typeof response.text === "function"
          ? await response.text().catch(() => "")
          : ""
      const firstLine = text.split(/\r?\n/)[0] || ""
      input.logger?.error?.(
        `[ops-alert-ack] ${input.fingerprint} failed: ${response.status} ${response.statusText} ${firstLine}`.trim()
      )
      return { ok: false, skipped: false }
    }
    return { ok: true, skipped: false }
  } catch (error) {
    input.logger?.error?.(`[ops-alert-ack] ${input.fingerprint} failed: ${error}`)
    return { ok: false, skipped: false }
  } finally {
    clearTimeout(timeout)
  }
}
