import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_PACKING,
  appendStaffAudit,
  ensureFinalizationForOrder,
  metadataObject,
} from "../../../../../../../lib/catch-weight-finalization"
import { actorId, jsonError, retrieveFinalizationOrder } from "../utils"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const actor = actorId(req)
  const detail = await ensureFinalizationForOrder(db, order, FINALIZATION_PACKING)

  await db("gp_order_finalization")
    .where({ id: detail.finalization.id })
    .update({
      status: FINALIZATION_PACKING,
      started_at: detail.finalization.started_at || new Date(),
      started_by: detail.finalization.started_by || actor,
      updated_at: new Date(),
    })

  const metadata = appendStaffAudit(
    {
      ...metadataObject(order.metadata),
      finalization_id: detail.finalization.id,
      finalization_status: FINALIZATION_PACKING,
      catch_weight_status: FINALIZATION_PACKING,
    },
    {
      action: "catch_weight_packing_started",
      status: FINALIZATION_PACKING,
      staff_actor_id: actor,
    }
  )
  await orderModule.updateOrders(order.id, { metadata })

  res.status(200).json({
    order,
    finalization: {
      ...detail.finalization,
      status: FINALIZATION_PACKING,
      started_by: detail.finalization.started_by || actor,
    },
    lines: detail.lines,
  })
}
