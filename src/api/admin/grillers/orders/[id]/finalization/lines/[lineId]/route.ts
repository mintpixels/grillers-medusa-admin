import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
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
  const finalization = await db("gp_order_finalization")
    .where({ id: line.finalization_id })
    .whereNull("deleted_at")
    .first()
  const finalizationStatus = finalization?.status || "picking"
  const metadata = appendStaffAudit(
    {
      ...metadataObject(order.metadata),
      finalization_status: finalizationStatus,
      catch_weight_status: finalizationStatus,
    },
    {
      action: "catch_weight_line_updated",
      status: finalizationStatus,
      line_item_id: req.params.lineId,
      staff_actor_id: actorId(req),
    }
  )
  await orderModule.updateOrders(order.id, { metadata })

  res.status(200).json({ line })
}
