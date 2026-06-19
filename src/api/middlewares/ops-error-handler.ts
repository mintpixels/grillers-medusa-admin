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

const CHECKOUT_PREFIX = "/store/grillers/checkout"

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

export function opsErrorHandler(
  err: any,
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
): void {
  // emitOpsAlert never throws; guard belt-and-suspenders so alerting can never
  // change error-handling behavior.
  try {
    const path = typeof req.path === "string" ? req.path : ""
    const method = typeof req.method === "string" ? req.method : ""
    const status = inferStatus(err)
    const isCheckout = path.startsWith(CHECKOUT_PREFIX)

    // Fire-and-forget for warn; await for page (the lib handles both). Do NOT
    // await here at all — delegate to core synchronously so the response isn't
    // delayed; emitOpsAlert's page path self-awaits internally.
    void emitOpsAlert({
      alertKind: "api_unhandled_error",
      severity: isCheckout ? "page" : "warn",
      path,
      title: `api unhandled error ${status}: ${err?.name || "error"}`,
      // Only status/method/path/error name+message(sliced) — no request bodies,
      // headers, query, or params. NOTE: `path` and `error_message` are
      // upstream-controlled and could in rare cases embed user input that an
      // upstream error interpolated; the 300-char slice caps length, not
      // sensitivity. Acceptable here because the ops_alert sink is internal-only.
      meta: {
        status,
        method,
        path,
        error_name: err?.name,
        error_message:
          typeof err?.message === "string" ? err.message.slice(0, 300) : undefined,
      },
      logger: req.scope?.resolve?.(ContainerRegistrationKeys.LOGGER),
    })
  } catch {
    // Never let alerting interfere with the client error response.
  }

  // Preserve the existing client error response exactly.
  return coreErrorHandler(err, req, res, next)
}
