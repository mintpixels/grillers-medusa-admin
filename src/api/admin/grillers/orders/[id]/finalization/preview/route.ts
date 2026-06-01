import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { previewFinalization } from "../../../../../../../lib/catch-weight-finalization"
import { jsonError, retrieveFinalizationOrder } from "../utils"

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await retrieveFinalizationOrder(req, req.params.id)

  if (!order) {
    return jsonError(res, 404, "Order was not found.")
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const preview = await previewFinalization(db, order, {
    persist: Boolean((req.body as Record<string, any> | undefined)?.persist),
  })

  res.status(200).json({
    order,
    ...preview,
  })
}
