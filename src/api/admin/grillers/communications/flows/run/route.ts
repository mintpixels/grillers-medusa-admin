import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  refreshProfileLifecycle,
  runCommunicationMaintenance,
} from "../../../../../../lib/communications/admin"
import { emitAdminCommunicationsRouteFailureAlert } from "../../_shared/alerts"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const lifecycle = await refreshProfileLifecycle(req.scope)
    const flows = await runCommunicationMaintenance(req.scope)
    res.status(202).json({ ok: true, lifecycle, flows })
  } catch (error) {
    await emitAdminCommunicationsRouteFailureAlert({
      req,
      action: "run_maintenance",
      error,
    })
    res.status(500).json({ ok: false, error: "maintenance_run_failed" })
  }
}
