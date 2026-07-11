import {
  errorHandler as coreErrorHandlerFactory,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../lib/ops-alert"

// Medusa's router uses `sourceErrorHandler ?? errorHandler()` — providing a
// custom errorHandler REPLACES the default. So we emit an ops alert and then
// DELEGATE to the core handler so the client error response is byte-identical
// (status, body, schema). We never swallow the error.
const coreErrorHandler = coreErrorHandlerFactory()

const MONEY_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// Keep this allowlist deliberately narrow. These routes can create, capture,
// refund, or cancel money movement. Read-only payment/finalization routes and
// ordinary cart mutations should never be promoted to a page just because a
// URL happens to contain "payment" or "checkout".
const HIGH_RISK_MONEY_ROUTES = [
  /^\/store\/grillers\/checkout\/place-order\/?$/,
  /^\/admin\/grillers\/payments\/[^/]+\/refund\/?$/,
  /^\/admin\/grillers\/orders\/[^/]+\/finalization\/(?:charge-and-release|retry-charge|refund-final-charge)\/?$/,
  /^\/admin\/payments\/[^/]+\/(?:capture|refund)\/?$/,
  /^\/admin\/orders\/[^/]+\/cancel\/?$/,
]

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]{1,64}$/
const ENTITY_ID_SEGMENT = /^(?:[A-Za-z]{2,16})_[A-Za-z0-9_]{6,}$/
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Best-effort status inference matching Medusa's core errorHandler mapping,
 * used ONLY to label the alert. The actual HTTP response is produced by the
 * delegated core handler, never by this function.
 */
function inferStatus(err: any): number {
  const type = err?.type || err?.name
  switch (type) {
    case "QueryRunnerAlreadyReleasedError":
    case "TransactionAlreadyStartedError":
    case "TransactionNotStartedError":
    case "conflict":
      return 409
    case "unauthorized":
      return 401
    case "payment_authorization_error":
    case "duplicate_error":
      return 422
    case "not_allowed":
    case "invalid_data":
      return 400
    case "not_found":
      return 404
    default:
      return 500
  }
}

/**
 * Prefer Express' matched route template, which contains parameter names rather
 * than customer/order values. If it is unavailable, redact identifier-like or
 * non-slug path segments. Query strings are never read.
 */
function requestRoute(req: MedusaRequest): string {
  const routePath = (req as any)?.route?.path
  const baseUrl =
    typeof (req as any)?.baseUrl === "string" ? (req as any).baseUrl : ""
  const matchedRoute =
    typeof routePath === "string" ? `${baseUrl}${routePath}` : ""
  const rawPath =
    matchedRoute.startsWith("/store/") ||
    matchedRoute.startsWith("/admin/") ||
    matchedRoute.startsWith("/webhooks/")
      ? matchedRoute
      : typeof req.path === "string"
        ? req.path
        : matchedRoute

  const pathOnly = rawPath.split(/[?#]/, 1)[0].slice(0, 512)
  const segments = pathOnly.split("/").map((segment) => {
    if (!segment || segment.startsWith(":")) return segment
    if (
      UUID_SEGMENT.test(segment) ||
      ENTITY_ID_SEGMENT.test(segment) ||
      /^\d+$/.test(segment) ||
      !SAFE_PATH_SEGMENT.test(segment)
    ) {
      return ":id"
    }
    return segment
  })

  const sanitized = segments.join("/").slice(0, 240)
  return sanitized.startsWith("/") ? sanitized : `/${sanitized}`
}

/**
 * Request IDs are useful for joining an alert to platform logs. Only accept an
 * opaque token shape; never forward arbitrary header text.
 */
function requestId(req: MedusaRequest): string | undefined {
  const candidates = [
    (req as any)?.id,
    req.headers?.["x-request-id"],
    req.headers?.["x-correlation-id"],
  ]

  for (const candidate of candidates) {
    const value = Array.isArray(candidate) ? candidate[0] : candidate
    if (typeof value === "string" && SAFE_REQUEST_ID.test(value)) {
      return value
    }
  }

  return undefined
}

function safeErrorLabel(err: any): string {
  const value = err?.type || err?.name
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value)
    ? value
    : "error"
}

function isHighRiskMoneyRequest(route: string, method: string): boolean {
  if (!MONEY_MUTATION_METHODS.has(method.toUpperCase())) return false
  return HIGH_RISK_MONEY_ROUTES.some((pattern) => pattern.test(route))
}

export function opsErrorHandler(
  err: any,
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  // emitOpsAlert never throws; guard belt-and-suspenders so alerting can never
  // change error-handling behavior.
  try {
    const route = requestRoute(req)
    const method = typeof req.method === "string" ? req.method.toUpperCase() : ""
    const status = inferStatus(err)
    const highRiskMoneyPath = isHighRiskMoneyRequest(route, method)

    // Medusa's core handler intentionally treats validation, auth, not-found,
    // conflicts, and payment-decline errors as 4xx. Those are client outcomes,
    // not operational incidents, so the global handler leaves them to normal
    // request logging. Route-specific code may still emit a purpose-built alert
    // when a particular 4xx represents an integrity failure.
    if (status >= 500) {
      const errorType = safeErrorLabel(err)

      // Fire-and-forget for warn; await for page (the lib handles both). Do NOT
      // await here at all — delegate to core synchronously so the response isn't
      // delayed; emitOpsAlert's page path self-awaits internally.
      void emitOpsAlert({
        alertKind: "api_unhandled_error",
        severity: highRiskMoneyPath ? "page" : "warn",
        path: route,
        title: `api unhandled error ${status}: ${errorType}`,
        // Never forward error messages, bodies, headers, query strings, params,
        // or raw URLs from this global boundary. The core handler retains the
        // full exception in application logs; the opaque request ID joins the
        // sanitized alert to those logs without duplicating possible PII.
        meta: {
          status,
          method,
          route,
          request_id: requestId(req) || null,
          error_type: errorType,
          error_code:
            typeof err?.code === "string" &&
            /^[A-Za-z0-9_.:-]{1,80}$/.test(err.code)
              ? err.code
              : null,
          high_risk_money_path: highRiskMoneyPath,
        },
        logger: req.scope?.resolve?.(ContainerRegistrationKeys.LOGGER),
      })
    }
  } catch {
    // Never let alerting interfere with the client error response.
  }

  // Preserve the existing client error response exactly.
  return coreErrorHandler(err, req, res, next)
}
