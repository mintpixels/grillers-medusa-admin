import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requestPreferencesLink,
  verifyServiceApiKey,
} from "../../../lib/communications/core"

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  const email = String((req.body as Record<string, any>)?.email || "")
    .trim()
    .toLowerCase()
  if (email) {
    await requestPreferencesLink(req.scope, email).catch(() => undefined)
  }
  res.status(202).json({ ok: true })
}
