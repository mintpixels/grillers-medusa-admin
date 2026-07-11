import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  recordIdentity,
  upsertCustomerProfile,
  verifyServiceApiKey,
  withoutSmsConsentEvidence,
} from "../../../lib/communications/core"
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

const PUBLIC_IDENTIFY_METADATA_KEYS = new Set([
  "experiment_context",
  "language",
  "locale",
  "timezone",
])

function publicIdentifyMetadata(traits: Record<string, any>) {
  const sanitized = withoutSmsConsentEvidence(traits)
  return Object.fromEntries(
    Object.entries(sanitized).filter(([key]) =>
      PUBLIC_IDENTIFY_METADATA_KEYS.has(key)
    )
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const traits = body.traits || body.properties || {}
  const logger = communicationsApiLogger(req)

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const profile = await upsertCustomerProfile(db, {
      email: traits.email || body.email,
      // The identify key is intentionally public for storefront analytics,
      // so this endpoint is never authoritative evidence of written SMS
      // consent. Customer-created/updated subscribers read the authenticated
      // Medusa customer record and promote qualifying v3 evidence instead.
      metadata: publicIdentifyMetadata(traits),
    })

    if (profile) {
      await recordIdentity(db, profile.id, {
        anonymous_id: body.anonymous_id,
        session_id: body.session_id,
        cart_id: body.cart_id,
        email: traits.email || body.email,
      })
    }

    await recordCommunicationEvent(db, {
      event_name: "identify",
      source: "storefront",
      profile_id: profile?.id,
      anonymous_id: body.anonymous_id,
      session_id: body.session_id,
      cart_id: body.cart_id,
      email: traits.email || body.email,
      properties: publicIdentifyMetadata(traits),
    })

    res.status(202).json({ ok: true, profile_id: profile?.id || null })
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "identify",
      path: "src/api/api/identify/route.ts",
      eventName: "identify",
      hasEmail: Boolean(traits.email || body.email),
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "identify_failed" })
  }
}
