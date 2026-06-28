import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updatePostmarkMessageState } from "../../../lib/communications/core"
import { emitOpsAlert } from "../../../lib/ops-alert"

function header(req: MedusaRequest, name: string): string {
  const headers = req.headers as any
  return headers[name.toLowerCase()] || headers.get?.(name) || ""
}

function authorized(req: MedusaRequest): boolean {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET || ""
  if (!secret) return true
  const querySecret =
    typeof req.query?.secret === "string" ? req.query.secret : undefined
  return (
    querySecret === secret ||
    header(req, "x-postmark-webhook-secret") === secret ||
    header(req, "x-webhook-secret") === secret ||
    header(req, "authorization") === `Bearer ${secret}`
  )
}

function redactEmail(value: string): string {
  return value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted-email]"
  )
}

function messageId(payload: Record<string, any>): string | null {
  const value = payload.MessageID || payload.MessageId || payload.MessageID__c
  return typeof value === "string" && value ? value.slice(0, 120) : null
}

function recordType(payload: Record<string, any>): string {
  const value = payload.RecordType || payload.Type || "unknown"
  return String(value || "unknown").toLowerCase().slice(0, 80)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const payload = (req.body || {}) as Record<string, any>
  let logger: any
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    await updatePostmarkMessageState(db, payload)
    res.status(202).json({ ok: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[postmark-webhook] processing failed: ${errorMessage}`)
    await emitOpsAlert({
      alertKind: "postmark_webhook_processing_failed",
      title: "Postmark webhook processing failed",
      path: "src/api/postmark/webhook/route.ts",
      source: "medusa-server",
      severity: "warn",
      fingerprint: `postmark_webhook:processing_failed:${recordType(payload)}`,
      meta: {
        record_type: recordType(payload),
        postmark_message_id: messageId(payload),
        has_recipient: Boolean(payload.Recipient || payload.Email || payload.email),
        error_message: redactEmail(errorMessage).slice(0, 500),
      },
      logger,
    })
    res.status(500).json({ ok: false, error: "webhook_processing_failed" })
  }
}
