import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createCampaign } from "../../../../../lib/communications/admin"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const campaigns = await db("gp_campaign")
    .whereNull("deleted_at")
    .select("*")
    .orderBy("created_at", "desc")
    .limit(Math.min(100, Number(req.query?.limit || 50)))
  res.status(200).json({ campaigns })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  if (!body.name || !body.subject) {
    res.status(400).json({ error: "name and subject are required" })
    return
  }
  const actor = (req as any).auth_context?.actor_id || null
  const campaign = await createCampaign(req.scope, {
    name: body.name,
    subject: body.subject,
    segment_key: body.segment_key,
    intro: body.intro,
    body: body.body,
    cta_label: body.cta_label,
    cta_url: body.cta_url,
    scheduled_at: body.scheduled_at,
    approved_by: actor,
  })
  res.status(201).json({ campaign })
}
