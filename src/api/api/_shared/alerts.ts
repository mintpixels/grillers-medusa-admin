import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import { emitOpsAlert } from "../../../lib/ops-alert"

type AlertLogger = Pick<Logger, "warn" | "error">

function redactEmail(value: string): string {
  return value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted-email]"
  )
}

function slug(value: unknown, fallback = "unknown"): string {
  const raw = typeof value === "string" ? value : String(value ?? "")
  const safe = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return safe ? safe.slice(0, 80) : fallback
}

export function communicationsApiLogger(req: MedusaRequest): AlertLogger | undefined {
  try {
    return req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    return undefined
  }
}

export async function emitCommunicationsApiFailureAlert(input: {
  operation: string
  path: string
  error: unknown
  logger?: AlertLogger
  eventName?: string | null
  eventCount?: number | null
  hasEmail?: boolean
  hasToken?: boolean
}) {
  const operation = slug(input.operation)
  const errorMessage =
    input.error instanceof Error ? input.error.message : String(input.error ?? "")

  return emitOpsAlert({
    alertKind: "communications_api_request_failed",
    title: `Communications API ${operation} failed`,
    path: input.path,
    source: "medusa-server",
    severity: "warn",
    fingerprint: `communications_api_request_failed:${operation}`,
    meta: {
      operation,
      event_name: input.eventName ? slug(input.eventName) : null,
      event_count: input.eventCount ?? null,
      has_email: Boolean(input.hasEmail),
      has_token: Boolean(input.hasToken),
      error_message: redactEmail(errorMessage).slice(0, 500),
    },
    logger: input.logger,
  })
}
