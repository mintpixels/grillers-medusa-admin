import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendCampaign } from "../../../../../../../lib/communications/admin"
import { emitAdminCommunicationsRouteFailureAlert } from "../../../_shared/alerts"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  const actor = (req as any).auth_context?.actor_id || null
  try {
    const result = await sendCampaign(req.scope, String(req.params.id), {
      test_email: body.test_email || null,
      approved_by: actor,
    })
    res.status(202).json({ ok: true, ...result })
  } catch (error) {
    await emitAdminCommunicationsRouteFailureAlert({
      req,
      action: "send_campaign",
      error,
      meta: {
        campaign_id: req.params.id || null,
        test_send: Boolean(body.test_email),
      },
    })
    res.status(500).json({ ok: false, error: "campaign_send_failed" })
  }
}
