import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { searchCommunicationProfiles } from "../../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = typeof req.query?.q === "string" ? req.query.q : undefined
  const limit = Number(req.query?.limit || 25)
  const offset = Number(req.query?.offset || 0)
  try {
    res.status(200).json(
      await searchCommunicationProfiles(req.scope, { q, limit, offset })
    )
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "profile_search",
      error,
      errorCode: "communication_profile_search_failed",
      meta: {
        has_query: Boolean(q),
        limit,
        offset,
      },
    })
  }
}
