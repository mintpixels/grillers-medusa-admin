import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  applyInboundSmsConsentChange,
  classifyInboundSms,
  marketingSmsInboundWebhookUrl,
  validateMarketingTwilioWebhookTarget,
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
 * Twilio/carrier-owned STOP/START/Advanced-Opt-Out replies receive empty
 * TwiML; the application still persists the consent change before acking.
 */

function twiml(message?: string): string {
  if (!message) return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
}

export function marketingInboundClassificationInput(
  params: Record<string, string>
): string {
  const managedOptOutType = String(params.OptOutType || "")
    .trim()
    .toLowerCase()
  const bodyKeyword = String(params.Body || "").trim().toLowerCase()
  if (managedOptOutType === "stop") return "stop"
  if (managedOptOutType === "help") return "help"
  if (
    managedOptOutType === "start" &&
    (bodyKeyword === "start" || bodyKeyword === "unstop")
  ) {
    return bodyKeyword
  }
  return params.Body || ""
}

export function marketingKeywordReplyOwnedByTwilio(
  params: Record<string, string>,
  action: "stop" | "start" | "help" | "none"
): boolean {
  // OptOutType means Advanced Opt-Out already matched and replied. Toll-free
  // STOP/START network replies are carrier-owned even without OptOutType.
  return (
    Boolean(String(params.OptOutType || "").trim()) ||
    action === "stop" ||
    action === "start"
  )
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

  if (
    !verifyTwilioSignature({
      signature,
      url: marketingSmsInboundWebhookUrl(),
      params,
    })
  ) {
    logger?.warn?.("[twilio-sms] rejected inbound: bad signature")
    res.status(401).send("unauthorized")
    return
  }
  if (!validateMarketingTwilioWebhookTarget(params, "inbound")) {
    logger?.warn?.("[twilio-sms] rejected inbound: wrong Twilio target")
    res.status(401).send("unauthorized")
    return
  }

  try {
    const from = String(params.From || "")
    const decision = classifyInboundSms(
      marketingInboundClassificationInput(params)
    )
    let reply = decision.reply

    if (decision.action === "stop" || decision.action === "start") {
      const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const result = await applyInboundSmsConsentChange(
        db,
        from,
        decision.action,
        { messageSid: params.MessageSid || null }
      )
      logger?.info?.(
        `[twilio-sms] ${decision.action} from ${from.slice(-4)} → ${result.updated} profile(s)${
          result.nonRestorationReason
            ? `; not restored: ${result.nonRestorationReason}`
            : ""
        }`
      )
    }

    if (marketingKeywordReplyOwnedByTwilio(params, decision.action)) {
      reply = undefined
    }

    res.setHeader("Content-Type", "text/xml")
    res.status(200).send(twiml(reply))
  } catch (error) {
    logger?.error?.(
      `[twilio-sms] handler error: ${error instanceof Error ? error.message : String(error)}`
    )
    // Twilio retries verified 5xx webhooks. Acknowledging a failed STOP write
    // would lose the local suppression even though the carrier already blocked.
    res.setHeader("Content-Type", "text/xml")
    res.status(500).send(twiml())
  }
}
