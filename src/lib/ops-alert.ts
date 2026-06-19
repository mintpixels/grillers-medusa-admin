import { createHash, randomUUID } from "node:crypto"
import type { Logger } from "@medusajs/framework/types"

export type OpsAlertSeverity = "page" | "warn" | "info"

type OpsAlertInput = {
  alertKind: string
  title: string
  path: string
  source?: string
  eventId?: string
  url?: string | null
  severity?: OpsAlertSeverity
  fingerprint?: string
  meta?: Record<string, unknown>
  logger?: Pick<Logger, "warn" | "error">
}

// Money/integrity alerts AWAIT the POST so a dropped page at least hits Railway
// logs; non-page alerts fire-and-forget. Keep this short — never block a request.
const PAGE_TIMEOUT_MS = 2500

/**
 * Strip per-incident identifiers so titles collapse to one fingerprint key:
 * lowercase, then remove UUIDs, order_/cart_/pi_/fin_-style ids, and digits.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      ""
    )
    // strip entity ids (order_…, cart_…, pi_…) including underscore-joined suffixes
    .replace(
      /\b(?:order|cart|pi|fin|refund|attempt|prod|variant)_[a-z0-9_]+/g,
      ""
    )
    .replace(/\d+/g, "")
    // collapse leftover separators (stray underscores/dashes from stripped ids)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function computeFingerprint(
  source: string,
  alertKind: string,
  title: string
): string {
  return createHash("sha1")
    .update(`${source}:${alertKind}:${normalizeTitle(title)}`)
    .digest("hex")
}

export async function emitOpsAlert(input: OpsAlertInput) {
  // Proven sink: the gp-analytics ingestion API → grillers_pride.events.
  // The dead Jitsu path (JITSU_HOST/api/v1/s2s/event → ops_timeline) had 0 rows.
  const endpoint = process.env.GP_ANALYTICS_ENDPOINT?.replace(/\/+$/, "")
  const serverKey = process.env.GP_ANALYTICS_SERVER_KEY

  const severity: OpsAlertSeverity = input.severity ?? "warn"
  const source = input.source ?? "medusa-server"

  if (!endpoint || !serverKey) {
    input.logger?.warn?.(
      `[ops-alert] skipped ${input.alertKind}: GP_ANALYTICS_ENDPOINT/GP_ANALYTICS_SERVER_KEY missing`
    )
    return { ok: false, skipped: true }
  }

  const fingerprint =
    input.fingerprint ||
    computeFingerprint(source, input.alertKind, input.title)

  const now = Date.now()
  const body = {
    event: "ops_alert",
    event_id: input.eventId || randomUUID(),
    event_timestamp_ms: now,
    session_id: randomUUID(),
    anonymous_id: randomUUID(),
    experience_version: "medusa",
    route_market: "national",
    customer_type: "dtc",
    source: "medusa-server",
    properties: {
      alert_kind: input.alertKind,
      severity,
      fingerprint,
      path: input.path,
      title: input.title,
      url: input.url ?? null,
      release: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
      env: process.env.NODE_ENV ?? "production",
      ...(input.meta || {}),
    },
    context: {
      library: {
        name: "grillers-medusa-admin-ops-alert",
        version: "0.1.0",
      },
    },
  }

  const url = `${endpoint}/v1/track`
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serverKey}`,
  }

  // Non-page alerts: fire-and-forget so we never block the caller's hot path.
  if (severity !== "page") {
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
      .then(async (response) => {
        if (response.ok) return
        const text =
          typeof response.text === "function"
            ? await response.text().catch(() => "")
            : ""
        const firstLine = text.split(/\r?\n/)[0] || ""
        input.logger?.error?.(
          `[ops-alert] ${input.alertKind} failed: ${response.status} ${response.statusText} ${firstLine}`.trim()
        )
      })
      .catch((error) => {
        input.logger?.error?.(`[ops-alert] ${input.alertKind} failed: ${error}`)
      })
    return { ok: true, skipped: false }
  }

  // Page (money/integrity) alerts: AWAIT with a short timeout so a dropped
  // alert is at least visible in Railway logs.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS)
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
        `[ops-alert] ${input.alertKind} failed: ${response.status} ${response.statusText} ${firstLine}`.trim()
      )
      return { ok: false, skipped: false }
    }

    return { ok: true, skipped: false }
  } catch (error) {
    input.logger?.error?.(`[ops-alert] ${input.alertKind} failed: ${error}`)
    return { ok: false, skipped: false }
  } finally {
    clearTimeout(timeout)
  }
}
