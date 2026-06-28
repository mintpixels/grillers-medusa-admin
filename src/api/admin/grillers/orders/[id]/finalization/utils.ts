import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CATCH_WEIGHT_ORDER_FIELDS } from "../../../../../../lib/catch-weight-finalization"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

export function jsonError(
  res: MedusaResponse,
  status: number,
  message: string,
  extra?: Record<string, any>
) {
  res.status(status).json({ message, ...(extra || {}) })
}

export async function retrieveFinalizationOrder(
  req: MedusaRequest,
  orderId: string
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: CATCH_WEIGHT_ORDER_FIELDS,
    filters: { id: orderId },
  })
  return data?.[0] || null
}

export function actorId(req: MedusaRequest) {
  return (req as any).auth_context?.actor_id || null
}

export function staffAuditFields(
  req: MedusaRequest,
  body?: Record<string, any> | null
) {
  return {
    staff_actor_id: actorId(req),
    staff_actor_customer_id:
      typeof body?.staff_actor_customer_id === "string"
        ? body.staff_actor_customer_id
        : null,
    staff_actor_email:
      typeof body?.staff_actor_email === "string"
        ? body.staff_actor_email
        : null,
    staff_actor_name:
      typeof body?.staff_actor_name === "string"
        ? body.staff_actor_name
        : null,
  }
}

export function staffAuditActorId(fields: Record<string, any>) {
  return fields.staff_actor_customer_id || fields.staff_actor_id || null
}

function routeErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || "Unknown error")

  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b(?:order|cart|pi|pm|py|pay|refund|re|fin|attempt|prod|variant)_[A-Za-z0-9_]+/g,
      "[redacted-id]"
    )
}

export async function emitFinalizationRouteFailureAlert(input: {
  req: MedusaRequest
  action: string
  error: unknown
  order?: Record<string, any> | null
  orderId?: string | null
  path: string
  status: number
}) {
  const logger = input.req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const message = routeErrorMessage(input.error)

  return emitOpsAlert({
    alertKind: "catch_weight_finalization_route_failed",
    title: `Catch-weight finalization route failed: ${input.action}`,
    path: input.path,
    source: "medusa-server",
    severity: "page",
    logger,
    meta: {
      action: input.action,
      order_id: input.order?.id || input.orderId || null,
      route_status: input.status,
      error_message: message.slice(0, 500),
    },
  })
}
