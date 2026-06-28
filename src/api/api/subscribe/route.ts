import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  preferenceUrl,
  subscribeProfile,
  verifyServiceApiKey,
} from "../../../lib/communications/core"
import {
  communicationsApiLogger,
  emitCommunicationsApiFailureAlert,
} from "../_shared/alerts"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

function header(req: MedusaRequest, name: string): string {
  const headers = req.headers as any
  return headers[name.toLowerCase()] || headers.get?.(name) || ""
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const email = String(body.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "invalid_email" })
    return
  }

  const logger = communicationsApiLogger(req)
  try {
    const profile = await subscribeProfile(req.scope, {
      email,
      source: body.source || null,
      source_url: body.source_url || header(req, "referer") || null,
      consent_version: body.consent_version || "v1-2026-05",
      preferences: body.preferences || null,
      ip: header(req, "x-forwarded-for") || header(req, "x-real-ip") || null,
      user_agent: header(req, "user-agent") || null,
    })

    res.status(200).json({
      ok: true,
      subscriber: profile
        ? {
            email: profile.email,
            status: profile.email_consent ? "subscribed" : "unsubscribed",
            preferences: profile.preferences || {},
            preferences_url: preferenceUrl(profile.preference_token),
          }
        : null,
    })
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "subscribe",
      path: "src/api/api/subscribe/route.ts",
      eventName: "email_signup",
      hasEmail: true,
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "subscribe_failed" })
  }
}
