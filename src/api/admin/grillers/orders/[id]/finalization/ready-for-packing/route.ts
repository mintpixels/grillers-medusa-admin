import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_READY_FOR_PACKING,
  appendStaffAudit,
  markFinalizationReadyForPacking,
  metadataObject,
} from "../../../../../../../lib/catch-weight-finalization"
import {
  emitFinalizationRouteFailureAlert,
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

  try {
    const detail = await markFinalizationReadyForPacking(db, order, actor)

    const metadata = appendStaffAudit(
      {
        ...metadataObject(order.metadata),
        finalization_id: detail.finalization.id,
        finalization_status: FINALIZATION_READY_FOR_PACKING,
        catch_weight_status: FINALIZATION_READY_FOR_PACKING,
      },
      {
        action: "catch_weight_ready_for_packing",
        status: FINALIZATION_READY_FOR_PACKING,
        ...staffAudit,
      }
    )
    await orderModule.updateOrders(order.id, { metadata })

    res.status(200).json({
      order,
      finalization: detail.finalization,
      lines: detail.lines,
    })
  } catch (error) {
    await emitFinalizationRouteFailureAlert({
      req,
      action: "ready_for_packing",
      error,
      order,
      orderId: req.params.id,
      path: "src/api/admin/grillers/orders/[id]/finalization/ready-for-packing/route.ts",
      status: 409,
    })
    return jsonError(
      res,
      409,
      error instanceof Error
        ? error.message
        : "Could not mark order ready for packing."
    )
  }
}
