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
