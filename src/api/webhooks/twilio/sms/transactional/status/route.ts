import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  applyTransactionalSmsStatus,
  transactionalSmsStatusWebhookUrlForMessage,
  twilioFormParams,
  validateTransactionalTwilioWebhookTarget,
  verifyTransactionalTwilioSignature,
} from "../../../../../../lib/communications/transactional-sms"

function signatureHeader(req: MedusaRequest): string {
  return String(
    (req.headers as any)["x-twilio-signature"] ||
      (req.headers as any)["X-Twilio-Signature"] ||
      ""
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER) as any
  const params = twilioFormParams(req)
  const messageLogId = String(
    (req as any)?.query?.gp_message_id ||
      (req as any)?.query_params?.gp_message_id ||
      ""
  ).trim()
  const signedUrl = transactionalSmsStatusWebhookUrlForMessage(messageLogId)
  if (
    !signedUrl ||
    !verifyTransactionalTwilioSignature({
      signature: signatureHeader(req),
      url: signedUrl,
      params,
    })
  ) {
    logger?.warn?.("[transactional-sms-status] rejected bad signature")
    res.status(401).send("unauthorized")
    return
  }
  if (!validateTransactionalTwilioWebhookTarget(params, "status")) {
    logger?.warn?.("[transactional-sms-status] rejected wrong Twilio target")
    res.status(401).send("unauthorized")
    return
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const result = await applyTransactionalSmsStatus(db, {
      messageLogId,
      messageSid: params.MessageSid || "",
      messagingServiceSid: params.MessagingServiceSid || "",
      messageStatus: params.MessageStatus || params.SmsStatus || "",
      errorCode: params.ErrorCode || null,
      errorMessage: params.ErrorMessage || null,
    })
    if (!result.found) {
      logger?.warn?.(
        `[transactional-sms-status] message not found sid=${String(
          params.MessageSid || ""
        ).slice(0, 8)}`
      )
      // A callback can race the provider response that stores MessageSid.
      // Return a retryable status so Twilio has another chance to apply the
      // delivery state instead of silently losing the terminal callback.
      res.status(503).send("message not ready")
      return
    }
    res.status(204).send("")
  } catch (error) {
    logger?.error?.(
      `[transactional-sms-status] handler failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    // Twilio may retry 5xx callbacks; the handler is idempotent and monotonic.
    res.status(500).send("status update failed")
  }
}
