import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_PACKED_PENDING_CHARGE,
  appendStaffAudit,
  approveFinalization,
  metadataObject,
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

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const orderModule = req.scope.resolve(Modules.ORDER)
    const body = (req.body || {}) as Record<string, any>
    const staffAudit = staffAuditFields(req, body)
    const approved = await approveFinalization(
      db,
      order,
      staffAuditActorId(staffAudit)
    )
    const metadata = appendStaffAudit(
      {
        ...metadataObject(order.metadata),
        finalization_id: approved.finalization.id,
        finalization_status: FINALIZATION_PACKED_PENDING_CHARGE,
        catch_weight_status: FINALIZATION_PACKED_PENDING_CHARGE,
        final_total: approved.totals.final_order_total,
        catch_weight_delta: approved.totals.delta_total,
      },
      {
        action: "catch_weight_finalization_approved",
        status: FINALIZATION_PACKED_PENDING_CHARGE,
        ...staffAudit,
      }
    )
    await orderModule.updateOrders(order.id, { metadata })
    res.status(200).json({
      order,
      ...approved,
    })
  } catch (error) {
    return jsonError(
      res,
      409,
      error instanceof Error
        ? error.message
        : "Finalization could not be approved."
    )
  }
}
