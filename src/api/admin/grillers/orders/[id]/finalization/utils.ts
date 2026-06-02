import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { CATCH_WEIGHT_ORDER_FIELDS } from "../../../../../../lib/catch-weight-finalization"

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
