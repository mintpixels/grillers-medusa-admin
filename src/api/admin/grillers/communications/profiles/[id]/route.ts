import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationProfileTimeline } from "../../../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "../../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const profile = await communicationProfileTimeline(
      req.scope,
      String(req.params.id)
    )
    if (!profile) {
      res.status(404).json({ error: "not_found" })
      return
    }
    res.status(200).json(profile)
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "profile_timeline",
      error,
      errorCode: "communication_profile_timeline_failed",
      meta: {
        has_profile_id: Boolean(req.params.id),
      },
    })
  }
}
