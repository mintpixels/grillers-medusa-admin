import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  recordSuppression,
  verifyServiceApiKey,
} from "../../../../lib/communications/core"
import {
  communicationsApiLogger,
  emitCommunicationsApiFailureAlert,
} from "../../_shared/alerts"

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

  const token = String(req.params.token || "")
  const logger = communicationsApiLogger(req)
  let profile: Record<string, any> | null = null
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    profile = token
      ? await db("gp_customer_profile")
          .whereNull("deleted_at")
          .where("preference_token", token)
          .first()
      : null

    if (!profile) {
      res.status(404).json({ error: "not_found" })
      return
    }

    await db("gp_customer_profile")
      .where("id", profile.id)
      .update({ email_consent: false, updated_at: new Date() })
    await recordSuppression(db, {
      email: profile.email,
      scope: "marketing",
      reason: "customer_unsubscribe",
      source: "preferences_page",
    })
    await recordCommunicationEvent(db, {
      event_name: "email_unsubscribed",
      profile_id: profile.id,
      email: profile.email,
      source: "storefront",
      properties: { scope: "marketing" },
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "unsubscribe",
      path: "src/api/api/unsubscribe/[token]/route.ts",
      eventName: "email_unsubscribed",
      hasEmail: Boolean(profile?.email),
      hasToken: Boolean(token),
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "unsubscribe_failed" })
  }
}
