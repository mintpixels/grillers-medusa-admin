import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitAdminCommunicationsRouteFailureAlert } from "../../_shared/alerts"

/**
 * Delete a console-built segment (soft delete + membership exit).
 * Seeded GP-library segments are code-managed and refused — pausing or
 * changing them is a code concern, and flows/campaigns reference them.
 */
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const key = String(req.params.key || "")
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const segment = await db("gp_segment")
      .whereNull("deleted_at")
      .where("key", key)
      .first()
    if (!segment) {
      res.status(404).json({ error: "segment_not_found" })
      return
    }
    if (!(segment.metadata || {}).custom) {
      res.status(409).json({ error: "built_in_segments_cannot_be_deleted" })
      return
    }
    const now = new Date()
    await db("gp_segment")
      .where("id", segment.id)
      .update({ deleted_at: now, status: "archived", updated_at: now })
    await db("gp_segment_member")
      .whereNull("deleted_at")
      .where("segment_id", segment.id)
      .update({ exited_at: now, updated_at: now })
    res.status(200).json({ ok: true, deleted: key })
  } catch (error) {
    await emitAdminCommunicationsRouteFailureAlert({
      req,
      action: "delete_segment",
      error,
      meta: { segment_key: key },
    })
    res.status(500).json({ ok: false, error: "segment_delete_failed" })
  }
}
