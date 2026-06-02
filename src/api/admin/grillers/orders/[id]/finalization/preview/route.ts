import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  appendStaffAudit,
  metadataObject,
  previewFinalization,
} from "../../../../../../../lib/catch-weight-finalization"
import { jsonError, retrieveFinalizationOrder, staffAuditFields } from "../utils"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const body = (req.body as Record<string, any> | undefined) || {}
  const persist = Boolean(body.persist)
  const preview = await previewFinalization(db, order, {
    persist,
  })

  if (persist) {
    const status = preview.finalization.status || "packed_pending_review"
    const metadata = appendStaffAudit(
      {
        ...metadataObject(order.metadata),
        finalization_id: preview.finalization.id,
        finalization_status: status,
        catch_weight_status: status,
        final_total: preview.totals.final_order_total,
        catch_weight_delta: preview.totals.delta_total,
      },
      {
        action: "catch_weight_finalization_previewed",
        status,
        error_count: preview.errors.length,
        ...staffAuditFields(req, body),
      }
    )
    await orderModule.updateOrders(order.id, { metadata })
  }

  res.status(200).json({
    order,
    ...preview,
  })
}
