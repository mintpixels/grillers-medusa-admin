import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../ops-alert"
import {
  hasQualifyingSmsMarketingConsent,
  recordCommunicationEvent,
  type CommunicationPurpose,
  type CommunicationStream,
} from "./core"
import { isInSendBlackout } from "./hebrew-calendar"

type KnexLike = any

/**
 * SMS channel for GP Comms (Twilio REST, no SDK dependency).
 *
 * Consent model (TCPA):
 *  - Marketing/lifecycle texts require profile.sms_consent — the versioned
 *    record written by signup/checkout/first-login verification. Checked AT
 *    SEND TIME, so a STOP that landed a second ago wins.
 *  - STOP/UNSUBSCRIBE (webhook below) flips consent off, writes a
 *    suppression row for audit, and Twilio's own carrier-level block is a
 *    second net under ours.
 *  - Quiet hours: no marketing SMS outside COMMS_SMS_QUIET_* (default
 *    09:00–20:30 America/New_York) — conservative inside TCPA's 8am–9pm.
 *  - Shabbat/Yom Tov blackout applies platform-wide, same as email.
 *  - Weekly cap: COMMS_SMS_WEEKLY_CAP (default 2) per recipient across all
 *    campaigns/flows.
 */

const TWILIO_API = "https://api.twilio.com/2010-04-01"

function twilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || ""
  const authToken = process.env.TWILIO_AUTH_TOKEN || ""
  const apiKeySid = process.env.TWILIO_API_KEY_SID || ""
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || ""
  const from = process.env.TWILIO_MESSAGING_FROM || ""
  const user = apiKeySid || accountSid
  const pass = apiKeySid ? apiKeySecret : authToken
  return {
    accountSid,
    from,
    user,
    pass,
    configured: Boolean(accountSid && user && pass && from),
  }
}

export function smsConfigured(): boolean {
  return twilioConfig().configured
}

/** digits-only 10-digit US → E.164. Returns null when not normalizable. */
export function toE164(value: string | null | undefined): string | null {
  const digits = String(value || "").replace(/\D/g, "")
  const ten =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (ten.length !== 10) return null
  return `+1${ten}`
}

// ─── Quiet hours (America/New_York) ──────────────────────────────────

function etMinutesOfDay(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at)
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0)
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0)
  return (hour % 24) * 60 + minute
}

function parseHm(value: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return fallbackMinutes
  return Number(m[1]) * 60 + Number(m[2])
}

export function isInSmsQuietHours(at: Date = new Date()): boolean {
  const start = parseHm(process.env.COMMS_SMS_QUIET_START || "09:00", 9 * 60)
  const end = parseHm(process.env.COMMS_SMS_QUIET_END || "20:30", 20 * 60 + 30)
  const nowMin = etMinutesOfDay(at)
  // Allowed window is [start, end); anything else is quiet.
  return !(nowMin >= start && nowMin < end)
}

export type SendTrackedSmsInput = {
  to?: string | null
  body: string
  stream: CommunicationStream
  purpose?: CommunicationPurpose
  template_key: string
  topic?: string | null
  profile_id?: string | null
  medusa_customer_id?: string | null
  flow_id?: string | null
  flow_key?: string | null
  flow_enrollment_id?: string | null
  campaign_id?: string | null
  order_id?: string | null
  cart_id?: string | null
  idempotency_key?: string | null
  /**
   * Staff-initiated test to an explicitly typed number. Consent still
   * applies; quiet hours and the weekly cap are skipped for template
   * iteration. The Shabbat/Yom Tov blackout still applies.
   */
  staff_test?: boolean
}

export type SendTrackedSmsResult = {
  ok: boolean
  skipped?: boolean
  deferred?: boolean
  deferUntil?: Date
  messageSid?: string
  error?: string
}

export function resolveSmsPurpose(
  stream: CommunicationStream,
  purpose?: CommunicationPurpose
): CommunicationPurpose {
  if (purpose) return purpose
  if (stream === "broadcast") return "broadcast"
  if (stream === "lifecycle") return "marketing_1to1"
  return "transactional"
}

export function isSmsMarketingPurpose(purpose: CommunicationPurpose): boolean {
  return purpose === "marketing_1to1" || purpose === "broadcast"
}

const NON_MARKETING_SMS_LANGUAGE =
  /\b(order|delivery|shipping|shipment|tracking|pickup|receipt|confirmation)\b/i

export function validateSmsMarketingContent(body: unknown): string | null {
  const text = String(body || "").trim()
  if (!text) return "sms_body_missing"
  if (NON_MARKETING_SMS_LANGUAGE.test(text)) {
    return "sms_use_case_mismatch"
  }
  if (!/griller'?s pride/i.test(text)) return "sms_brand_missing"
  if (!/\bstop\b/i.test(text)) return "sms_opt_out_instruction_missing"
  return null
}

function metadataObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

export function canRestoreSmsMarketingConsentByKeyword(
  profile: Record<string, any>,
  phone: unknown
): boolean {
  const metadata = metadataObject(profile.metadata)
  return hasQualifyingSmsMarketingConsent(
    {
      ...profile,
      sms_consent: true,
      sms_consent_at: metadata.sms_consent_at,
      metadata,
    },
    phone
  )
}

export async function sendTrackedSms(
  container: MedusaContainer,
  input: SendTrackedSmsInput
): Promise<SendTrackedSmsResult> {
  const db = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as KnexLike
  const now = new Date()
  const config = twilioConfig()
  const purpose = resolveSmsPurpose(input.stream, input.purpose)

  let profile = input.profile_id
    ? await db("gp_customer_profile")
        .whereNull("deleted_at")
        .where("id", input.profile_id)
        .first()
    : null

  const phone = toE164(input.to || profile?.phone)
  if (!phone) {
    return { ok: false, error: "missing_or_invalid_phone" }
  }
  if (!profile) {
    const ten = phone.slice(-10)
    profile = await db("gp_customer_profile")
      .whereNull("deleted_at")
      .whereRaw("regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like ?", [
        `%${ten}`,
      ])
      .first()
  }

  const suppress = async (reason: string, extra: Record<string, unknown> = {}) => {
    await recordCommunicationEvent(db, {
      event_name: "sms_suppressed",
      email: profile?.email || null,
      profile_id: profile?.id || input.profile_id || null,
      template_key: input.template_key,
      campaign_id: input.campaign_id,
      flow_id: input.flow_id,
      order_id: input.order_id,
      cart_id: input.cart_id,
      properties: {
        channel: "sms",
        stream: input.stream,
        purpose,
        topic: input.topic || null,
        phone_last4: phone.slice(-4),
        reason,
        ...extra,
      },
    })
    return { ok: true, skipped: true } as SendTrackedSmsResult
  }

  // Toll-free verification covers marketing only. Do not silently use the
  // number for order, delivery, or other transactional/service programs.
  if (!isSmsMarketingPurpose(purpose)) {
    return suppress("sms_purpose_not_approved", { purpose })
  }

  const contentError = validateSmsMarketingContent(input.body)
  if (contentError) return suppress(contentError)

  // 1) Consent at send time is keyed to message PURPOSE, not Twilio stream.
  // A one-to-one marketing flow may ride the transactional stream for
  // delivery, but it still needs the exact customer-originated v3 evidence.
  if (!hasQualifyingSmsMarketingConsent(profile, phone)) {
    return suppress("missing_qualified_sms_marketing_consent")
  }

  // 2) Shabbat/Yom Tov, quiet hours, and caps are marketing rules and must
  // follow the semantic purpose even when the physical stream is named
  // "transactional".
  if (isSmsMarketingPurpose(purpose)) {
    const blackout = isInSendBlackout(now)
    if (blackout.blocked) {
      await recordCommunicationEvent(db, {
        event_name: "sms_deferred_blackout",
        profile_id: profile?.id || input.profile_id || null,
        template_key: input.template_key,
        campaign_id: input.campaign_id,
        flow_id: input.flow_id,
        properties: {
          channel: "sms",
          reason: blackout.reason || "shabbat_blackout",
          defer_until: blackout.until ? blackout.until.toISOString() : null,
        },
      })
      return {
        ok: false,
        deferred: true,
        deferUntil: blackout.until,
        error: "shabbat_blackout",
      }
    }

    // 3) Quiet hours (TCPA): defer to the next window opening. Staff
    // tests to the operator's own phone are exempt.
    if (!input.staff_test && isInSmsQuietHours(now)) {
      return {
        ok: false,
        deferred: true,
        error: "sms_quiet_hours",
      }
    }

    // 4) Weekly cap (staff tests exempt).
    const cap = Number(process.env.COMMS_SMS_WEEKLY_CAP || 2)
    if (!input.staff_test && Number.isFinite(cap) && cap > 0) {
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const recent = await db("gp_message_log")
        .whereNull("deleted_at")
        .where("channel", "sms")
        .whereIn("message_purpose", ["broadcast", "marketing_1to1"])
        .whereRaw("metadata->>'phone' = ?", [phone])
        .whereIn("status", ["queued", "sent", "delivered"])
        .where("created_at", ">=", since)
        .count("id as count")
      if (Number(recent?.[0]?.count || 0) >= cap) {
        return suppress("frequency_cap", { cap })
      }
    }
  }

  // 5) Idempotency.
  const idempotencyKey =
    input.idempotency_key ||
    [
      "sms",
      input.stream,
      input.template_key,
      phone,
      input.order_id || input.cart_id || input.campaign_id || input.flow_enrollment_id || "",
    ].join(":")
  const existing = await db("gp_message_log")
    .whereNull("deleted_at")
    .where("idempotency_key", idempotencyKey)
    .first()
  if (existing && ["queued", "sent", "delivered"].includes(existing.status)) {
    return { ok: true, skipped: true, messageSid: existing.postmark_message_id || undefined }
  }

  if (!config.configured) {
    return suppress("sms_not_configured")
  }

  const messageId = existing?.id || `gpmsg_${crypto.randomBytes(8).toString("hex")}`
  const row = {
    id: messageId,
    idempotency_key: idempotencyKey,
    profile_id: profile?.id || input.profile_id || null,
    medusa_customer_id: input.medusa_customer_id || profile?.medusa_customer_id || null,
    email: profile?.email || "",
    email_lower: (profile?.email_lower as string) || "",
    channel: "sms",
    message_stream: input.stream,
    message_purpose: purpose,
    topic: input.topic || null,
    template_key: input.template_key,
    flow_id: input.flow_id || null,
    flow_key: input.flow_key || null,
    flow_enrollment_id: input.flow_enrollment_id || null,
    campaign_id: input.campaign_id || null,
    order_id: input.order_id || null,
    cart_id: input.cart_id || null,
    subject: input.body.slice(0, 120),
    status: "queued",
    metadata: { phone, body_length: input.body.length },
    queued_at: now,
    created_at: now,
    updated_at: now,
  }
  if (existing) {
    await db("gp_message_log").where("id", existing.id).update({ ...row, id: undefined, created_at: undefined })
  } else {
    try {
      await db("gp_message_log").insert(row)
    } catch (err: any) {
      // Unique violation on idempotency_key: a concurrent duplicate fire
      // (double-clicked approve, at-least-once queue delivery) already
      // claimed this send. Treat as skipped — the winner texts once.
      if (String(err?.code) === "23505") {
        return { ok: true, skipped: true }
      }
      throw err
    }
  }

  try {
    const params = new URLSearchParams({
      To: phone,
      From: config.from,
      Body: input.body,
    })
    const response = await fetch(
      `${TWILIO_API}/Accounts/${config.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.user}:${config.pass}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    )
    const body: any = await response.json().catch(() => ({}))
    if (!response.ok || body?.error_code) {
      throw new Error(String(body?.message || `twilio_http_${response.status}`))
    }

    await db("gp_message_log").where("id", messageId).update({
      status: "sent",
      sent_at: new Date(),
      postmark_message_id: body?.sid || null,
      provider_response: { sid: body?.sid, status: body?.status },
      updated_at: new Date(),
    })
    await recordCommunicationEvent(db, {
      event_name: "sms_sent",
      email: profile?.email || null,
      profile_id: profile?.id || input.profile_id || null,
      template_key: input.template_key,
      campaign_id: input.campaign_id,
      flow_id: input.flow_id,
      order_id: input.order_id,
      cart_id: input.cart_id,
      properties: {
        channel: "sms",
        stream: input.stream,
        purpose,
        phone_last4: phone.slice(-4),
        message_sid: body?.sid || null,
      },
    })
    return { ok: true, messageSid: body?.sid }
  } catch (error: any) {
    await db("gp_message_log").where("id", messageId).update({
      status: "failed",
      failed_at: new Date(),
      error_message: String(error?.message || error).slice(0, 300),
      updated_at: new Date(),
    })
    await emitOpsAlert({
      alertKind: "communications_sms_send_failed",
      severity: "warn",
      title: "SMS send failed",
      path: "src/lib/communications/sms.ts",
      fingerprint: `sms_send:${input.template_key}`,
      meta: {
        template_key: input.template_key,
        stream: input.stream,
        purpose,
        message: String(error?.message || error).slice(0, 200),
      },
    }).catch(() => {})
    return { ok: false, error: String(error?.message || error) }
  }
}

// ─── Inbound STOP/HELP handling ──────────────────────────────────────

export type InboundSmsDecision = {
  action: "stop" | "start" | "help" | "none"
  reply?: string
}

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"])
const START_WORDS = new Set(["start", "unstop", "yes"])

export function classifyInboundSms(body: string): InboundSmsDecision {
  const word = String(body || "").trim().toLowerCase()
  if (STOP_WORDS.has(word)) {
    return {
      action: "stop",
      reply:
        "You've been unsubscribed from Griller's Pride texts and will receive no further messages. Reply START to resubscribe.",
    }
  }
  if (START_WORDS.has(word)) {
    return {
      action: "start",
      reply:
        "You're resubscribed to Griller's Pride marketing texts with specials, holiday promotions, and product availability announcements. Msg & data rates may apply. Reply STOP to unsubscribe, HELP for help.",
    }
  }
  if (word === "help" || word === "info") {
    return {
      action: "help",
      reply:
        "Griller's Pride marketing texts include specials, holiday promotions, and product availability announcements. Msg & data rates may apply. Reply STOP to unsubscribe. Questions? (770) 454-8108.",
    }
  }
  return { action: "none" }
}

export function smsWebOptInRequiredReply(): string {
  const storefront =
    process.env.STOREFRONT_BASE_URL ||
    "https://grillers-medusa-frontend.vercel.app"
  return `Griller's Pride could not restore marketing consent by text. To opt in, use the unchecked marketing-text checkbox during storefront account signup or first-login contact verification at ${storefront}/us/account. If that form is not shown, call (770) 454-8108. Reply HELP for help.`
}

/** Apply a STOP/START to the matching profile(s) by phone. */
export async function applyInboundSmsConsentChange(
  db: KnexLike,
  phoneE164: string,
  action: "stop" | "start"
): Promise<{ updated: number }> {
  const digits = phoneE164.replace(/\D/g, "")
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  const profiles = await db("gp_customer_profile")
    .whereNull("deleted_at")
    .whereRaw("regexp_replace(coalesce(phone, ''), '\\D', '', 'g') like ?", [
      `%${ten}`,
    ])
    .select(
      "id",
      "email",
      "email_lower",
      "phone",
      "sms_consent",
      "sms_consent_at",
      "metadata"
    )

  let updated = 0
  for (const profile of profiles) {
    const metadata = metadataObject(profile.metadata)
    if (action === "start") {
      if (!canRestoreSmsMarketingConsentByKeyword(profile, phoneE164)) {
        // START may restore a previously documented v3 marketing opt-in; it
        // must never upgrade a mixed/legacy/staff-attested record into valid
        // express written consent.
        continue
      }
    }
    const changedAt = new Date()
    await db("gp_customer_profile").where("id", profile.id).update({
      sms_consent: action === "start",
      sms_consent_at: action === "start" ? changedAt : null,
      metadata: {
        ...metadata,
        sms_consent_status:
          action === "start" ? "subscribed" : "unsubscribed",
        ...(action === "start"
          ? {
              sms_consent_restart_at: changedAt.toISOString(),
              sms_consent_restart_source: "twilio_inbound_start",
            }
          : {
              sms_opt_out_at: changedAt.toISOString(),
              sms_opt_out_source: "twilio_inbound_stop",
            }),
      },
      updated_at: changedAt,
    })
    await recordCommunicationEvent(db, {
      event_name: action === "stop" ? "sms_opt_out" : "sms_opt_in_restored",
      email: profile.email || null,
      profile_id: profile.id,
      properties: { channel: "sms", phone_last4: ten.slice(-4), source: "twilio_inbound" },
    })
    updated += 1
  }
  return { updated }
}

/**
 * Twilio webhook signature: base64(HMAC-SHA1(url + sorted-concat params,
 * auth token)). Reject on mismatch unless no auth token is configured
 * (local dev).
 */
export function verifyTwilioSignature(input: {
  signature: string
  url: string
  params: Record<string, string>
}): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN || ""
  if (!authToken) return true
  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((k) => `${k}${input.params[k]}`)
      .join("")
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64")
  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature || "")
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
