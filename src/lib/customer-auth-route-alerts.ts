import type { MedusaRequest } from "@medusajs/framework/http"
import { emitOpsAlert } from "./ops-alert"

type LoggerLike = {
  warn?: (message: string) => void
  error?: (message: string) => void
}

type CustomerAuthRouteAction = "legacy_login" | "password_change"

function authContext(req: MedusaRequest) {
  return ((req as any).auth_context || {}) as Record<string, any>
}

function redactedErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")

  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b(?:auth|cus|customer|pi|provider|legacy)_[A-Za-z0-9_]+/g,
      "[redacted-id]"
    )
    .slice(0, 500)
}

function identifierKind(value: unknown) {
  const identifier = String(value || "").trim()
  if (!identifier) return "missing"
  return identifier.includes("@") ? "email" : "legacy_identifier"
}

export async function emitCustomerAuthRouteFailureAlert(input: {
  req: MedusaRequest
  action: CustomerAuthRouteAction
  path: string
  error: unknown
  identifier?: unknown
  logger?: LoggerLike
}) {
  const context = authContext(input.req)

  return emitOpsAlert({
    alertKind: "customer_auth_route_failed",
    severity: "page",
    title: `Customer auth route failed: ${input.action}`,
    path: input.path,
    source: "medusa-server",
    fingerprint: `customer_auth_route_failed:${input.action}`,
    logger: input.logger as any,
    meta: {
      action: input.action,
      actor_id: context.actor_id || null,
      has_auth_identity_id: Boolean(context.auth_identity_id),
      identifier_kind:
        input.identifier === undefined ? null : identifierKind(input.identifier),
      error_message: redactedErrorMessage(input.error),
    },
  })
}
