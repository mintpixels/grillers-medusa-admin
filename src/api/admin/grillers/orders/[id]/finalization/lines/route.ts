import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  addFinalizationLine,
  appendStaffAudit,
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

  try {
    const line = await addFinalizationLine(
      db,
      order,
      (req.body || {}) as Record<string, any>,
      actor
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
        action: "catch_weight_line_added",
        status: finalizationStatus,
        line_item_id: line.line_item_id,
        variant_id: line.variant_id,
        sku: line.sku,
        staff_actor_id: actor,
      }
    )
    await orderModule.updateOrders(order.id, { metadata })

    res.status(200).json({ line })
  } catch (error: any) {
    return jsonError(res, 400, error?.message || "Could not add item.")
  }
}
