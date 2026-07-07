import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendCampaign } from "../../../../../../../lib/communications/admin"
import { emitAdminCommunicationsRouteFailureAlert } from "../../../_shared/alerts"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  try {
    // NEVER pass the calling actor as approved_by: that would satisfy the
    // >500 two-person gate with the sender's own identity and skip the
    // Slack approval entirely (and record a fake approver in the audit
    // trail). The ONLY legitimate approval signals are campaign.approved_by
    // persisted by the Slack approve button (approveCampaignFromSlack,
    // allowlist-checked) — test sends bypass the gate via test_email.
    const result = await sendCampaign(req.scope, String(req.params.id), {
      test_email: body.test_email || null,
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
