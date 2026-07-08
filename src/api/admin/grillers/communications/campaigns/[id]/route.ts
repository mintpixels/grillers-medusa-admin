import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitAdminCommunicationsRouteFailureAlert } from "../../_shared/alerts"

/**
 * Delete a campaign DRAFT (soft delete). Sent campaigns are refused —
 * they're the audit trail for what actually went to customers (metrics,
 * approvals, audience snapshots all hang off the row).
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const campaignId = String(req.params.id || "")
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const campaign = await db("gp_campaign")
      .whereNull("deleted_at")
      .where("id", campaignId)
      .first()
    if (!campaign) {
      res.status(404).json({ error: "campaign_not_found" })
      return
    }
    if (campaign.status === "sent") {
      res.status(409).json({
        error: "sent_campaigns_are_audit_history",
      })
      return
    }
    await db("gp_campaign")
      .where("id", campaignId)
      .update({ deleted_at: new Date(), updated_at: new Date() })
    res.status(200).json({ ok: true, deleted: campaignId })
  } catch (error) {
    await emitAdminCommunicationsRouteFailureAlert({
      req,
      action: "delete_campaign",
      error,
      meta: { campaign_id: campaignId },
    })
    res.status(500).json({ ok: false, error: "campaign_delete_failed" })
  }
}
