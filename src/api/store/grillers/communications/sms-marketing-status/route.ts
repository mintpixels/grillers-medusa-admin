import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { hasQualifyingSmsMarketingConsent } from "../../../../../lib/communications/core"
import { smsMarketingCarrierState } from "../../../../../lib/communications/sms"

export type SmsMarketingStatus =
  | "subscribed"
  | "unsubscribed"
  | "not_subscribed"

export type SmsMarketingStatusResponse = {
  status: SmsMarketingStatus
  phone: string | null
  consented_at: string | null
  opted_out_at: string | null
}

function normalizedUsPhone(value: unknown): string | null {
  const digits = String(value || "").replace(/\D/g, "")
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? ten : null
}

function isoDate(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Customer-private marketing SMS status.
 *
 * The communications profile is the send-time source of truth: inbound STOP
 * and START update it synchronously, while Medusa customer metadata remains an
 * immutable consent-evidence snapshot and may be stale. Identity comes only
 * from authenticated middleware; this route accepts no customer selector.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "private, no-store")

  const customerId = String((req as any).auth_context?.actor_id || "").trim()
  if (!customerId) {
    return res.status(401).json({
      type: "not_authorized",
      message: "Please sign in to view marketing text status.",
    })
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
    const profile = await db("gp_customer_profile")
      .whereNull("deleted_at")
      .where("medusa_customer_id", customerId)
      .first()

    if (!profile) {
      const response: SmsMarketingStatusResponse = {
        status: "not_subscribed",
        phone: null,
        consented_at: null,
        opted_out_at: null,
      }
      return res.status(200).json(response)
    }

    const phone = normalizedUsPhone(profile.phone)
    const carrier = smsMarketingCarrierState(profile)
    const optedOutAt = carrier.optedOutAt
    const optedOutPhone = carrier.optedOutPhone?.slice(-10) || null
    const subscribed = Boolean(
      phone &&
        carrier.allowed &&
        hasQualifyingSmsMarketingConsent(profile, phone)
    )
    // A later START lifts the carrier block but does not manufacture written
    // consent. Report not_subscribed so the authenticated form can capture a
    // fresh v3 opt-in; report unsubscribed only while the carrier STOP remains.
    const explicitlyUnsubscribed = Boolean(
      !subscribed && optedOutAt && !carrier.carrierRestarted
    )

    const response: SmsMarketingStatusResponse = {
      status: subscribed
        ? "subscribed"
        : explicitlyUnsubscribed
          ? "unsubscribed"
          : "not_subscribed",
      phone: explicitlyUnsubscribed ? optedOutPhone || phone : phone,
      consented_at: subscribed ? isoDate(profile.sms_consent_at) : null,
      opted_out_at: optedOutAt,
    }

    return res.status(200).json(response)
  } catch {
    return res.status(500).json({
      type: "server_error",
      message: "Marketing text status is temporarily unavailable.",
    })
  }
}
