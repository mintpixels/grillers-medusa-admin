import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { searchCommunicationProfiles } from "../../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const q = typeof req.query?.q === "string" ? req.query.q : undefined
  const limit = Number(req.query?.limit || 25)
  const offset = Number(req.query?.offset || 0)
  res.status(200).json(
    await searchCommunicationProfiles(req.scope, { q, limit, offset })
  )
}
