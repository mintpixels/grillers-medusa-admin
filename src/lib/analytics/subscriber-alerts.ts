import type { Logger } from "@medusajs/framework/types"
import { emitOpsAlert } from "../ops-alert"

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

type AnalyticsSubscriberFailureInput = {
  logger: Pick<Logger, "warn" | "error">
  medusaEvent: string
  analyticsEvent: string
  entityId?: string | null
  path: string
  error: unknown
}

function redactedError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error || "analytics failure")
  return message.replace(EMAIL_RE, "[redacted-email]").slice(0, 500)
}

export async function emitAnalyticsSubscriberFailureAlert({
  logger,
  medusaEvent,
  analyticsEvent,
  entityId,
  path,
  error,
}: AnalyticsSubscriberFailureInput) {
  return emitOpsAlert({
    alertKind: "analytics_subscriber_failed",
    severity: "warn",
    title: `Analytics subscriber failed for ${medusaEvent}`,
    path,
    source: "medusa-server",
    logger,
    meta: {
      medusa_event: medusaEvent,
      analytics_event: analyticsEvent,
      entity_id: entityId || null,
      error: redactedError(error),
    },
  })
}
