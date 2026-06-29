import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationOverview } from "../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "./_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    res.status(200).json(await communicationOverview(req.scope))
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "overview",
      error,
      errorCode: "communications_overview_failed",
    })
  }
}
