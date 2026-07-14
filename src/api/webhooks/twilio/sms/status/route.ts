import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  applyMarketingSmsStatus,
  marketingSmsStatusWebhookUrlForMessage,
  validateMarketingTwilioWebhookTarget,
  verifyTwilioSignature,
} from "../../../../../lib/communications/sms"

function formParams(req: MedusaRequest): Record<string, string> {
  const body = (req as any).body
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    return Object.fromEntries(
      Object.entries(body)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string])
    )
  }
  const raw = (req as any).rawBody
  const text =
    typeof raw === "string"
      ? raw
      : raw && typeof raw.toString === "function"
        ? raw.toString("utf8")
        : ""
  return Object.fromEntries(new URLSearchParams(text).entries())
}

function signatureHeader(req: MedusaRequest): string {
  return String(
    (req.headers as any)["x-twilio-signature"] ||
      (req.headers as any)["X-Twilio-Signature"] ||
      ""
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const params = formParams(req)
  const messageLogId = String(
    (req as any)?.query?.gp_message_id ||
      (req as any)?.query_params?.gp_message_id ||
      ""
  ).trim()
  const signedUrl = marketingSmsStatusWebhookUrlForMessage(messageLogId)
  if (
    !signedUrl ||
    !verifyTwilioSignature({
      signature: signatureHeader(req),
      url: signedUrl,
      params,
    })
  ) {
    logger?.warn?.("[marketing-sms-status] rejected bad signature")
    res.status(401).send("unauthorized")
    return
  }
  if (!validateMarketingTwilioWebhookTarget(params, "status")) {
    logger?.warn?.("[marketing-sms-status] rejected wrong Twilio target")
    res.status(401).send("unauthorized")
    return
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const result = await applyMarketingSmsStatus(db, {
      messageLogId,
      messageSid: params.MessageSid || "",
      messagingServiceSid: params.MessagingServiceSid || "",
      messageStatus: params.MessageStatus || params.SmsStatus || "",
      errorCode: params.ErrorCode || null,
      errorMessage: params.ErrorMessage || null,
    })
    if (!result.found) {
      logger?.warn?.(
        `[marketing-sms-status] message not found sid=${String(
          params.MessageSid || ""
        ).slice(0, 8)}`
      )
      res.status(503).send("message not ready")
      return
    }
    res.status(204).send("")
  } catch (error) {
    logger?.error?.(
      `[marketing-sms-status] handler failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    res.status(500).send("status update failed")
  }
}
