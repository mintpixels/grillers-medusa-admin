import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DEFAULT_NEWSLETTER_PREFERENCES,
  recordCommunicationEvent,
  recordSuppression,
} from "../../../lib/communications/core"

/**
 * Public, tokenized preference center backend. The token is the profile's
 * metadata.preference_token (minted at send time) — knowing it proves the
 * customer received our email; no login required, no email enumeration
 * (lookups are by token only, responses never include other identifiers
 * beyond a masked email).
 */

const TOPICS = Object.keys(DEFAULT_NEWSLETTER_PREFERENCES)

function maskEmail(email: string): string {
  const [user, domain] = String(email || "").split("@")
  if (!user || !domain) return ""
  const head = user.slice(0, 2)
  return `${head}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`
}

async function profileByToken(db: any, token: string) {
  if (!token || token.length < 16) return null
  return db("gp_customer_profile")
    .whereNull("deleted_at")
    .whereRaw(`metadata->>'preference_token' = ?`, [token])
    .first()
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const profile = await profileByToken(db, String(req.params.token || ""))
    if (!profile) {
      res.status(404).json({ error: "not_found" })
      return
    }
    const preferences = (profile.preferences || {}) as Record<string, unknown>
    res.status(200).json({
      email_masked: maskEmail(profile.email),
      first_name: profile.first_name || "",
      email_consent: Boolean(profile.email_consent),
      topics: Object.fromEntries(
        TOPICS.map((topic) => [topic, preferences[topic] !== false])
      ),
    })
  } catch {
    res.status(500).json({ error: "preferences_unavailable" })
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const profile = await profileByToken(db, String(req.params.token || ""))
    if (!profile) {
      res.status(404).json({ error: "not_found" })
      return
    }
    const body = (req.body || {}) as Record<string, any>

    if (body.unsubscribe_all === true) {
      await recordSuppression(db, {
        email: profile.email,
        scope: "marketing",
        reason: "preference_center_unsubscribe",
        source: "preference_center",
        metadata: {},
      })
      await db("gp_customer_profile")
        .where("id", profile.id)
        .update({
          email_consent: false,
          preferences: Object.fromEntries(TOPICS.map((t) => [t, false])),
          updated_at: new Date(),
        })
      await recordCommunicationEvent(db, {
        event_name: "preference_center_unsubscribed_all",
        profile_id: profile.id,
        email: profile.email,
        source: "preference_center",
      })
      res.status(200).json({ ok: true, unsubscribed: true })
      return
    }

    const topics = (body.topics || {}) as Record<string, unknown>
    const next: Record<string, boolean> = {
      ...(profile.preferences || {}),
    }
    for (const topic of TOPICS) {
      if (topic in topics) next[topic] = Boolean(topics[topic])
    }
    await db("gp_customer_profile")
      .where("id", profile.id)
      .update({ preferences: next, updated_at: new Date() })
    await recordCommunicationEvent(db, {
      event_name: "preference_center_updated",
      profile_id: profile.id,
      email: profile.email,
      source: "preference_center",
      properties: { topics: next },
    })
    res.status(200).json({ ok: true, topics: next })
  } catch {
    res.status(500).json({ error: "preferences_update_failed" })
  }
}
