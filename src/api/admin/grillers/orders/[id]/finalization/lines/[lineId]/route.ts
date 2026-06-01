import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_PACKED_PENDING_REVIEW,
  appendStaffAudit,
  ensureFinalizationForOrder,
  metadataObject,
  updateFinalizationLine,
} from "../../../../../../../../lib/catch-weight-finalization"
import { actorId, jsonError, retrieveFinalizationOrder } from "../../utils"

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  await ensureFinalizationForOrder(db, order)
  const line = await updateFinalizationLine(
    db,
    order.id,
    req.params.lineId,
    (req.body || {}) as Record<string, any>
  )
  const metadata = appendStaffAudit(
    {
      ...metadataObject(order.metadata),
      finalization_status: FINALIZATION_PACKED_PENDING_REVIEW,
      catch_weight_status: FINALIZATION_PACKED_PENDING_REVIEW,
    },
    {
      action: "catch_weight_line_updated",
      status: FINALIZATION_PACKED_PENDING_REVIEW,
      line_item_id: req.params.lineId,
      staff_actor_id: actorId(req),
    }
  )
  await orderModule.updateOrders(order.id, { metadata })

  res.status(200).json({ line })
}
