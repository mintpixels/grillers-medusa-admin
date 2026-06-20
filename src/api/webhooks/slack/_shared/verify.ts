import { createHmac, timingSafeEqual } from "node:crypto"
import type { MedusaRequest } from "@medusajs/framework/http"

// Slack signs every request (slash commands AND interactivity) as:
//   X-Slack-Request-Timestamp: <unix seconds>
//   X-Slack-Signature: v0=<hex hmac-sha256(`v0:${timestamp}:${rawBody}`, signing_secret)>
// We verify over the EXACT raw urlencoded bytes (preserveRawBody) and reject
// anything older than 5 minutes to guard against replay.
//
// This file DUPLICATES the verification used by webhooks/slack/command/route.ts
// on purpose: that route is being modified by another change in parallel, so
// the interactivity endpoint keeps its own copy to avoid a cross-file conflict.
// Both copies must stay byte-identical in their HMAC contract (the same Slack
// signing secret signs both). Keep them in sync if either changes.
const SIGNATURE_TOLERANCE_SECONDS = 300

/**
 * Extract the exact raw request body. Slack's HMAC is computed over the bytes
 * as-sent, so we must verify against `rawBody` (preserved via the middleware's
 * preserveRawBody) — never a re-serialized parse, which can reorder/encode
 * differently. The re-serialize fallback only exists so an unsigned dev request
 * (no secret) still produces a parseable body.
 */
export function rawBodyString(
  req: Pick<MedusaRequest, "body"> & { rawBody?: unknown }
): string {
  const raw = (req as any).rawBody
  if (typeof raw === "string") return raw
  if (raw && typeof raw.toString === "function") return raw.toString("utf8")
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

export type SlackVerifyResult = { ok: true } | { ok: false; reason: string }

/**
 * Verify the Slack signature over the raw request body. This is the ONLY gate
 * on the interactivity endpoint (the route lives outside /admin and /store so
 * it bypasses Medusa auth). Posture mirrors the Stripe + slash-command webhooks:
 *  - secret unset + production                  → reject (never run open in prod).
 *  - secret unset + SLACK_ALLOW_UNSIGNED + dev  → accept, log warning.
 *  - secret unset otherwise                     → reject.
 *  - secret set                                 → strict HMAC + timestamp window.
 *
 * The open path is gated on an EXPLICIT opt-in (SLACK_ALLOW_UNSIGNED=true) AND
 * NODE_ENV !== "production", so a missing/misset NODE_ENV can never silently
 * open the endpoint.
 */
export function verifySlackSignature(
  req: Pick<MedusaRequest, "headers" | "body"> & { rawBody?: unknown },
  rawBody: string,
  opts?: { logger?: any; now?: number }
): SlackVerifyResult {
  const secret = process.env.SLACK_SIGNING_SECRET || ""
  if (!secret) {
    const explicitDevOptIn = process.env.SLACK_ALLOW_UNSIGNED === "true"
    const isProd = process.env.NODE_ENV === "production"
    if (explicitDevOptIn && !isProd) {
      opts?.logger?.warn?.(
        "[slack-interactivity] SLACK_SIGNING_SECRET not set — accepting unsigned request (SLACK_ALLOW_UNSIGNED dev opt-in)"
      )
      return { ok: true }
    }
    opts?.logger?.error?.(
      "[slack-interactivity] SLACK_SIGNING_SECRET not set — rejecting request"
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
