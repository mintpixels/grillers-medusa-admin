import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  applyTransactionalSmsKeyword,
  classifyTransactionalInboundSms,
  transactionalSmsInboundWebhookUrl,
  transactionalSmsStartNotEligibleReply,
  twilioFormParams,
  verifyTransactionalTwilioSignature,
  validateTransactionalTwilioWebhookTarget,
} from "../../../../../lib/communications/transactional-sms"

function twiml(message?: string): string {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`
}

function signatureHeader(req: MedusaRequest): string {
  return String(
    (req.headers as any)["x-twilio-signature"] ||
      (req.headers as any)["X-Twilio-Signature"] ||
      ""
  )
}

export function transactionalInboundClassificationInput(
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

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const params = twilioFormParams(req)
  if (
    !verifyTransactionalTwilioSignature({
      signature: signatureHeader(req),
      url: transactionalSmsInboundWebhookUrl(),
      params,
    })
  ) {
    logger?.warn?.("[transactional-sms-inbound] rejected bad signature")
    res.status(401).send("unauthorized")
    return
  }
  if (!validateTransactionalTwilioWebhookTarget(params, "inbound")) {
    logger?.warn?.("[transactional-sms-inbound] rejected wrong Twilio target")
    res.status(401).send("unauthorized")
    return
  }

  try {
    const managedOptOutType = String(params.OptOutType || "")
      .trim()
      .toLowerCase()
    // Advanced Opt-Out's classification is authoritative for STOP/HELP even
    // when Body is surprising. For toll-free re-opt-in, however, only the
    // carrier-recognized START/UNSTOP keywords may restore local state.
    const decision = classifyTransactionalInboundSms(
      transactionalInboundClassificationInput(params)
    )
    let reply = decision.reply

    if (decision.action === "stop" || decision.action === "start") {
      const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const result = await applyTransactionalSmsKeyword(db, {
        phone: params.From || "",
        action: decision.action,
        messageSid: params.MessageSid || null,
      })
      logger?.info?.(
        `[transactional-sms-inbound] ${decision.action} last4=${String(
          params.From || ""
        ).slice(-4)} updated=${result.updated} eligible=${result.eligible}`
      )
      if (decision.action === "start" && !result.eligible) {
        reply = transactionalSmsStartNotEligibleReply()
      }
    }

    // Advanced Opt-Out already sends its configured STOP/START/HELP reply.
    // A second TwiML Message would create duplicate compliance texts.
    if (managedOptOutType) reply = undefined

    res.setHeader("Content-Type", "text/xml")
    res.status(200).send(twiml(reply))
  } catch (error) {
    logger?.error?.(
      `[transactional-sms-inbound] handler failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    // Ask Twilio to retry a verified webhook when durable state could not be
    // changed. The state operation is idempotent under a per-phone lock.
    res.setHeader("Content-Type", "text/xml")
    res.status(500).send(twiml())
  }
}
