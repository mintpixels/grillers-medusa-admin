import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { normalizeEmail, verifyServiceApiKey } from "../../../lib/communications/core"
import {
  communicationsApiLogger,
  emitCommunicationsApiFailureAlert,
} from "../_shared/alerts"

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
  const email = normalizeEmail((req.body as Record<string, any>)?.email)
  const logger = communicationsApiLogger(req)
  let profile: Record<string, any> | null = null

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    profile = email
      ? await db("gp_customer_profile")
          .whereNull("deleted_at")
          .where("email_lower", email)
          .first()
      : null
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "lookup",
      path: "src/api/api/lookup/route.ts",
      eventName: "subscriber_lookup",
      hasEmail: Boolean(email),
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "lookup_failed" })
    return
  }

  res.status(200).json({
    subscriber: profile
      ? {
          email: profile.email,
          status: profile.email_consent ? "subscribed" : "unsubscribed",
          preferences: profile.preferences || {},
        }
      : null,
  })
}
