import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  refreshProfileLifecycle,
  runCommunicationMaintenance,
} from "../../../../../../lib/communications/admin"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const lifecycle = await refreshProfileLifecycle(req.scope)
  const flows = await runCommunicationMaintenance(req.scope)
  res.status(202).json({ ok: true, lifecycle, flows })
}
