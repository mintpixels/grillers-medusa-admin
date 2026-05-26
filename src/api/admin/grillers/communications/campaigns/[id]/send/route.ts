import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendCampaign } from "../../../../../../../lib/communications/admin"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  const actor = (req as any).auth_context?.actor_id || null
  const result = await sendCampaign(req.scope, String(req.params.id), {
    test_email: body.test_email || null,
    approved_by: actor,
  })
  res.status(202).json({ ok: true, ...result })
}
