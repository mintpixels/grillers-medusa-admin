import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { previewSegmentDefinition } from "../../../../../../lib/communications/admin"
import { emitAdminCommunicationsRouteFailureAlert } from "../../_shared/alerts"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  if (!body.definition || typeof body.definition !== "object") {
    res.status(400).json({ error: "definition object is required" })
    return
  }
  try {
    const preview = await previewSegmentDefinition(req.scope, body.definition)
    res.status(200).json(preview)
  } catch (error) {
    await emitAdminCommunicationsRouteFailureAlert({
      req,
      action: "preview_segment",
      error,
      meta: {},
    })
    res.status(500).json({ ok: false, error: "segment_preview_failed" })
  }
}
