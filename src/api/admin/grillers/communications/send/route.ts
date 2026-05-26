import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { sendStaffMessage } from "../../../../../lib/communications/admin"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  if (!body.to || !body.subject || !body.body) {
    res.status(400).json({ error: "to, subject, and body are required" })
    return
  }
  const result = await sendStaffMessage(req.scope, {
    to: body.to,
    subject: body.subject,
    heading: body.heading,
    body: body.body,
    stream: body.stream,
    topic: body.topic,
    order_id: body.order_id,
    profile_id: body.profile_id,
    staff_actor_email: (req as any).auth_context?.actor_id || null,
  })
  res.status(result.ok ? 202 : 500).json(result)
}
