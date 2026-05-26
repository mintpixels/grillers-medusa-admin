import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updatePostmarkMessageState } from "../../../lib/communications/core"

function header(req: MedusaRequest, name: string): string {
  const headers = req.headers as any
  return headers[name.toLowerCase()] || headers.get?.(name) || ""
}

function authorized(req: MedusaRequest): boolean {
  const secret = process.env.POSTMARK_WEBHOOK_SECRET || ""
  if (!secret) return true
  const querySecret =
    typeof req.query?.secret === "string" ? req.query.secret : undefined
  return (
    querySecret === secret ||
    header(req, "x-postmark-webhook-secret") === secret ||
    header(req, "x-webhook-secret") === secret ||
    header(req, "authorization") === `Bearer ${secret}`
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!authorized(req)) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const payload = (req.body || {}) as Record<string, any>
  await updatePostmarkMessageState(db, payload)
  res.status(202).json({ ok: true })
}
