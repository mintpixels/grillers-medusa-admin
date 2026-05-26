import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationProfileTimeline } from "../../../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const profile = await communicationProfileTimeline(
    req.scope,
    String(req.params.id)
  )
  if (!profile) {
    res.status(404).json({ error: "not_found" })
    return
  }
  res.status(200).json(profile)
}
