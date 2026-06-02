import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  FINALIZATION_PICKING,
  FINALIZATION_READY_FOR_PACKING,
  FINALIZATION_PACKING,
  appendStaffAudit,
  ensureFinalizationForOrder,
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

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const body = (req.body || {}) as { phase?: string }
  const staffAudit = staffAuditFields(req, body)
  const actor = staffAuditActorId(staffAudit)
  const phase = body.phase === "pack" ? "pack" : "pick"
  const nextStatus =
    phase === "pack" ? FINALIZATION_PACKING : FINALIZATION_PICKING
  const detail = await ensureFinalizationForOrder(db, order, nextStatus)

  if (
    phase === "pack" &&
    ![
      FINALIZATION_READY_FOR_PACKING,
      FINALIZATION_PACKING,
      "packed_pending_review",
      "packed_pending_charge",
      "charge_failed_hold",
    ].includes(detail.finalization.status)
  ) {
    return jsonError(
      res,
      409,
      "This order must be marked ready for packing before a packer starts."
    )
  }

  await db("gp_order_finalization")
    .where({ id: detail.finalization.id })
    .update({
      status: nextStatus,
      started_at: detail.finalization.started_at || new Date(),
      started_by: detail.finalization.started_by || actor,
      packed_at:
        phase === "pack" ? detail.finalization.packed_at || new Date() : null,
      packed_by:
        phase === "pack" ? detail.finalization.packed_by || actor : null,
      updated_at: new Date(),
    })

  const metadata = appendStaffAudit(
    {
      ...metadataObject(order.metadata),
      finalization_id: detail.finalization.id,
      finalization_status: nextStatus,
      catch_weight_status: nextStatus,
    },
    {
      action:
        phase === "pack"
          ? "catch_weight_packing_started"
          : "catch_weight_picking_started",
      status: nextStatus,
      ...staffAudit,
    }
  )
  await orderModule.updateOrders(order.id, { metadata })

  res.status(200).json({
    order,
    finalization: {
      ...detail.finalization,
      status: nextStatus,
      started_by: detail.finalization.started_by || actor,
      packed_by:
        phase === "pack" ? detail.finalization.packed_by || actor : null,
    },
    lines: detail.lines,
  })
}
