import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { getFinalizationDetail } from "../../../../../../lib/catch-weight-finalization"
import { jsonError, retrieveFinalizationOrder } from "./utils"

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const detail = await getFinalizationDetail(db, order)

  res.status(200).json({
    order,
    finalization: detail.finalization,
    lines: detail.lines,
    payment_setup: detail.payment_setup,
    charge_attempts: detail.charge_attempts,
  })
}
