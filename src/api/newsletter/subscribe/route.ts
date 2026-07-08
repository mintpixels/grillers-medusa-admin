import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DEFAULT_NEWSLETTER_PREFERENCES,
  recordCommunicationEvent,
  upsertCustomerProfile,
} from "../../../lib/communications/core"

/**
 * Public newsletter signup (storefront popup + footer forms). Creates or
 * updates the profile with express email consent and emits email_signup,
 * which enrolls the Welcome Series flow. The `website` field is a
 * honeypot — bots that fill it get a 200 and no write.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as Record<string, any>
  const email = String(body.email || "").trim().toLowerCase()

  if (body.website) {
    res.status(200).json({ ok: true })
    return
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    res.status(400).json({ error: "valid_email_required" })
    return
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const profile = await upsertCustomerProfile(db, {
      email,
      first_name: String(body.first_name || "").slice(0, 80) || undefined,
      email_consent: true,
      preferences: { ...DEFAULT_NEWSLETTER_PREFERENCES },
      metadata: {
        signup_source: String(body.source || "storefront_popup").slice(0, 60),
        signup_at: new Date().toISOString(),
      },
    })
    await recordCommunicationEvent(db, {
      event_name: "email_signup",
      profile_id: profile?.id || null,
      email,
      source: "storefront",
      properties: { source: String(body.source || "storefront_popup").slice(0, 60) },
    })
    res.status(200).json({ ok: true })
  } catch {
    res.status(500).json({ error: "subscribe_failed" })
  }
}
