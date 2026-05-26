import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { importConstantContactPayload } from "../../../../../lib/communications/imports"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) {
    res.status(400).json({ error: "rows array is required" })
    return
  }

  const result = await importConstantContactPayload(req.scope, rows, {
    uploaded_by: (req as any).auth_context?.actor_id || null,
    filename: body.filename || null,
  })
  res.status(202).json({ ok: true, ...result })
}
