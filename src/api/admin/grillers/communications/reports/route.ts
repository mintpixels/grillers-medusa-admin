import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationReports } from "../../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const days = Math.min(365, Math.max(1, Number(req.query?.days || 30)))
  try {
    res.status(200).json(await communicationReports(req.scope, days))
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "reports",
      error,
      errorCode: "communication_reports_failed",
      meta: { days },
    })
  }
}
