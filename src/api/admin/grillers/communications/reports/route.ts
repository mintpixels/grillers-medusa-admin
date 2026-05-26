import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationReports } from "../../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const days = Math.min(365, Math.max(1, Number(req.query?.days || 30)))
  res.status(200).json(await communicationReports(req.scope, days))
}
