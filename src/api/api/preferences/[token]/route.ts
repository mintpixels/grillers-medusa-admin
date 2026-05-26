import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  DEFAULT_NEWSLETTER_PREFERENCES,
  MARKETING_SUPPRESSION_SCOPES,
  recordCommunicationEvent,
  recordSuppression,
  verifyServiceApiKey,
} from "../../../../lib/communications/core"

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

async function findProfile(req: MedusaRequest) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const token = String(req.params.token || "")
  if (!token) return null
  return db("gp_customer_profile")
    .whereNull("deleted_at")
    .where("preference_token", token)
    .first()
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  const profile = await findProfile(req)
  if (!profile) {
    res.status(404).json({ error: "not_found" })
    return
  }
  res.status(200).json({
    email: profile.email,
    status: profile.email_consent ? "subscribed" : "unsubscribed",
    preferences: { ...DEFAULT_NEWSLETTER_PREFERENCES, ...(profile.preferences || {}) },
  })
}

export async function PATCH(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const profile = await findProfile(req)
  if (!profile) {
    res.status(404).json({ error: "not_found" })
    return
  }
  const body = (req.body || {}) as Record<string, any>
  const preferences = {
    ...DEFAULT_NEWSLETTER_PREFERENCES,
    ...(profile.preferences || {}),
    ...(body.preferences || {}),
  }
  const nextEmailConsent =
    body.status === "subscribed"
      ? true
      : body.status === "unsubscribed"
        ? false
        : profile.email_consent
  const now = new Date()
  await db("gp_customer_profile")
    .where("id", profile.id)
    .update({
      preferences,
      email_consent: nextEmailConsent,
      email_consent_at:
        nextEmailConsent && !profile.email_consent_at
          ? now
          : profile.email_consent_at,
      updated_at: now,
    })
  if (nextEmailConsent) {
    await db("gp_suppression_preference")
      .whereNull("deleted_at")
      .where("email_lower", profile.email_lower)
      .whereIn("scope", MARKETING_SUPPRESSION_SCOPES)
      .whereNull("topic")
      .whereNull("resubscribed_at")
      .update({ resubscribed_at: now, updated_at: now })
  }
  for (const [topic, enabled] of Object.entries(preferences)) {
    if (enabled) {
      await db("gp_suppression_preference")
        .whereNull("deleted_at")
        .where("email_lower", profile.email_lower)
        .whereIn("scope", MARKETING_SUPPRESSION_SCOPES)
        .where("topic", topic)
        .whereNull("resubscribed_at")
        .update({ resubscribed_at: now, updated_at: now })
    } else {
      await recordSuppression(db, {
        email: profile.email,
        scope: "marketing",
        topic,
        reason: "customer_topic_preference",
        source: "preferences_page",
        metadata: { preferences },
      })
    }
  }
  await recordCommunicationEvent(db, {
    event_name: "email_preferences_updated",
    profile_id: profile.id,
    email: profile.email,
    source: "storefront",
    properties: {
      preferences,
      status: nextEmailConsent ? "subscribed" : "unsubscribed",
    },
  })
  res.status(200).json({
    email: profile.email,
    status: nextEmailConsent ? "subscribed" : "unsubscribed",
    preferences,
  })
}
