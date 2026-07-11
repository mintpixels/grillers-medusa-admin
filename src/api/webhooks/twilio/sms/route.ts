import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  applyInboundSmsConsentChange,
  classifyInboundSms,
  smsWebOptInRequiredReply,
  verifyTwilioSignature,
} from "../../../../lib/communications/sms"

/**
 * Twilio inbound SMS webhook (STOP / START / HELP).
 *
 * Twilio → Phone Number → Messaging → "A message comes in":
 *   https://grillers-medusa-admin-production.up.railway.app/webhooks/twilio/sms
 *
 * Signature-verified (X-Twilio-Signature over the exact public URL +
 * sorted params, HMAC-SHA1 with the auth token). STOP flips
 * profile.sms_consent off IMMEDIATELY (consent is re-checked at every
 * send, so the next queued message already sees it); Twilio's own
 * carrier-level opt-out list is the second net underneath.
 *
 * Responds with TwiML so Twilio sends our compliance replies.
 */

const PUBLIC_URL =
  process.env.TWILIO_SMS_WEBHOOK_URL ||
  "https://grillers-medusa-admin-production.up.railway.app/webhooks/twilio/sms"

function twiml(message?: string): string {
  if (!message) return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
}

function bodyParams(req: MedusaRequest): Record<string, string> {
  const body = (req as any).body
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params[key] = value
    }
    return params
  }
  const raw = (req as any).rawBody
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw.toString === "function"
        ? raw.toString("utf8")
        : ""
  const params: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(text).entries()) {
    params[key] = value
  }
  return params
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  let logger: any
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  const params = bodyParams(req)
  const signature = String(
    (req.headers as any)["x-twilio-signature"] ||
      (req.headers as any)["X-Twilio-Signature"] ||
      ""
  )

  if (!verifyTwilioSignature({ signature, url: PUBLIC_URL, params })) {
    logger?.warn?.("[twilio-sms] rejected inbound: bad signature")
    res.status(401).send("unauthorized")
    return
  }

  // Past the signature gate: always 200 with TwiML so Twilio never retries
  // into an error loop.
  try {
    const from = String(params.From || "")
    const body = String(params.Body || "")
    const decision = classifyInboundSms(body)
    let reply = decision.reply

    if (decision.action === "stop" || decision.action === "start") {
      const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const result = await applyInboundSmsConsentChange(
        db,
        from,
        decision.action
      )
      logger?.info?.(
        `[twilio-sms] ${decision.action} from ${from.slice(-4)} → ${result.updated} profile(s)`
      )
      if (decision.action === "start" && result.updated === 0) {
        reply = smsWebOptInRequiredReply()
      }
    }

    res.setHeader("Content-Type", "text/xml")
    res.status(200).send(twiml(reply))
  } catch (error) {
    logger?.error?.(
      `[twilio-sms] handler error: ${error instanceof Error ? error.message : String(error)}`
    )
    res.setHeader("Content-Type", "text/xml")
    res.status(200).send(twiml())
  }
}
