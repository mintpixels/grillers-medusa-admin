import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { communicationTemplates } from "../../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json(await communicationTemplates(req.scope))
}
