import { randomUUID } from "node:crypto"
import type { Logger } from "@medusajs/framework/types"

// Reuses the EXACT ingestion contract that src/api/webhooks/slack/_shared/emit-ack.ts
// uses (POST {GP_ANALYTICS_ENDPOINT}/v1/track, Bearer GP_ANALYTICS_SERVER_KEY,
// event under top-level `event`, payload under `properties`) — the same path
// the analytics warehouse polls from grillers_pride.events. The only difference is
// the event name: `order_fulfillment_hold` (a Slack "Hold" click) or
// `order_fulfillment_release` (a "Release" click) so the audit trail of who held /
// released which order can be reconstructed from ClickHouse.
//
// HOLD_TIMEOUT_MS keeps this bounded: emitting the audit event must never hold
// Slack's ~3s interactivity response window. We AWAIT (so a dropped event is at
// least visible in Railway logs) but abort fast and fail-soft.
const HOLD_TIMEOUT_MS = 2500

export type OrderFulfillmentHoldInput = {
  /** The order id the Hold/Release button carried in its `value`. */
  orderId: string
  /** "hold" → order_fulfillment_hold; "release" → order_fulfillment_release. */
  action: "hold" | "release"
  /** Slack user id that clicked the button (e.g. "U12345"). */
  byUser: string
  /** Slack display name / username of the clicker, when present. */
  byName?: string
  logger?: Pick<Logger, "warn" | "error">
}

export type OrderFulfillmentHoldResult =
  | { ok: true; skipped: false }
  | { ok: false; skipped: true }
  | { ok: false; skipped: false }

/**
 * Emit an `order_fulfillment_hold` / `order_fulfillment_release` event to the
 * gp-analytics ingestion API. No-op (logs) when GP_ANALYTICS_ENDPOINT/
 * GP_ANALYTICS_SERVER_KEY are unset. Fail-soft: any non-2xx or thrown error is
 * logged and swallowed so the interactivity handler always returns 200 to Slack.
 * NEVER throws.
 */
export async function emitOrderFulfillmentHold(
  input: OrderFulfillmentHoldInput
): Promise<OrderFulfillmentHoldResult> {
  const endpoint = process.env.GP_ANALYTICS_ENDPOINT?.replace(/\/+$/, "")
  const serverKey = process.env.GP_ANALYTICS_SERVER_KEY

  const eventName =
    input.action === "hold"
      ? "order_fulfillment_hold"
      : "order_fulfillment_release"

  if (!endpoint || !serverKey) {
    input.logger?.warn?.(
      `[order-hold] skipped ${eventName} for ${input.orderId}: GP_ANALYTICS_ENDPOINT/GP_ANALYTICS_SERVER_KEY missing`
    )
    return { ok: false, skipped: true }
  }

  const now = Date.now()
  const body = {
    event: eventName,
    event_id: randomUUID(),
    event_timestamp_ms: now,
    session_id: randomUUID(),
    anonymous_id: randomUUID(),
    experience_version: "medusa",
    route_market: "national",
    customer_type: "dtc",
    source: "medusa-server",
    properties: {
      order_id: input.orderId,
      action: input.action,
      by_user: input.byUser,
      by_name: input.byName ?? null,
      at_ms: now,
      release: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      env: process.env.NODE_ENV ?? "production",
    },
    context: {
      library: {
        name: "grillers-medusa-admin-order-hold",
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
  const timeout = setTimeout(() => controller.abort(), HOLD_TIMEOUT_MS)
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
        `[order-hold] ${eventName} ${input.orderId} failed: ${response.status} ${response.statusText} ${firstLine}`.trim()
      )
      return { ok: false, skipped: false }
    }
    return { ok: true, skipped: false }
  } catch (error) {
    input.logger?.error?.(
      `[order-hold] ${eventName} ${input.orderId} failed: ${error}`
    )
    return { ok: false, skipped: false }
  } finally {
    clearTimeout(timeout)
  }
}
