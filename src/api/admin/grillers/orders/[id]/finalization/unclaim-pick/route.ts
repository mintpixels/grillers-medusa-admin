import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_PENDING_PICK,
  appendStaffAudit,
  metadataObject,
  unclaimFinalizationPick,
} from "../../../../../../../lib/catch-weight-finalization"
import {
  jsonError,
  retrieveFinalizationOrder,
  staffAuditActorId,
  staffAuditFields,
} from "../utils"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const body = (req.body || {}) as Record<string, any>
  const staffAudit = staffAuditFields(req, body)
  const actor = staffAuditActorId(staffAudit)
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Picker released the claimed pick."

  try {
    const detail = await unclaimFinalizationPick(db, order, actor, reason)
    const metadata = appendStaffAudit(
      {
        ...metadataObject(order.metadata),
        finalization_id: detail.finalization.id,
        finalization_status: FINALIZATION_PENDING_PICK,
        catch_weight_status: FINALIZATION_PENDING_PICK,
      },
      {
        action: "catch_weight_pick_unclaimed",
        status: FINALIZATION_PENDING_PICK,
        reason,
        ...staffAudit,
      }
    )
    await orderModule.updateOrders(order.id, { metadata })

    res.status(200).json({
      order,
      finalization: detail.finalization,
      lines: detail.lines,
    })
  } catch (error: any) {
    return jsonError(res, 409, error.message || "Could not unclaim pick.")
  }
}
