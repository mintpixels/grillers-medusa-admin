import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationTemplates } from "../../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    res.status(200).json(await communicationTemplates(req.scope))
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "templates",
      error,
      errorCode: "communication_templates_failed",
    })
  }
}
