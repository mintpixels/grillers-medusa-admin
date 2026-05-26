import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationOverview } from "../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json(await communicationOverview(req.scope))
}
