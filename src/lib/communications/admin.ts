import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buildSimpleMessageEmail } from "../emails/templates/simple-message"
import {
  normalizeEmail,
  recordCommunicationEvent,
  sendTrackedEmail,
  type CommunicationStream,
} from "./core"
import { runDueFlowEnrollments, seedCommunicationDefaults } from "./flows"
import { expireInactiveCarts } from "./cart-lifecycle"
import { communicationQueueHealth, enqueueCampaignSend } from "./queue"
import { communicationReporting } from "./reporting"
import { listEmailTemplates, seedEmailTemplates } from "./templates"
import { resolvePostmarkMonthlyLimit } from "./postmark-usage"

type KnexLike = any

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const now = () => new Date()

function dbFrom(container: MedusaContainer): KnexLike {
  return container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
}

function money(value: unknown): number {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function dateIso(value: unknown): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function postmarkUsageSummary(db: KnexLike) {
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const monthlyLimit = resolvePostmarkMonthlyLimit()
  const [monthlyMessages, byPurpose] = await Promise.all([
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", monthStart)
      .count({ count: "*" })
      .first(),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", monthStart)
      .select("message_purpose")
      .count({ count: "*" })
      .groupBy("message_purpose"),
  ])
  const sentThisMonth = Number(monthlyMessages?.count || 0)
  const usageRatio =
    monthlyLimit.configured && monthlyLimit.limit ? sentThisMonth / monthlyLimit.limit : null
  return {
    month_start: monthStart.toISOString(),
    sent_or_queued_this_month: sentThisMonth,
    configured_monthly_limit: monthlyLimit.limit,
    monthly_limit_configured: monthlyLimit.configured,
    configuration_warning: monthlyLimit.configuration_warning,
    configuration_error: monthlyLimit.configuration_error,
    usage_ratio: usageRatio,
    warning: monthlyLimit.configured && usageRatio !== null && usageRatio >= 0.8,
    by_purpose: byPurpose,
  }
}

export async function communicationOverview(container: MedusaContainer) {
  const db = dbFrom(container)
  await seedCommunicationDefaults(db)
  await seedEmailTemplates(db)

  const [
    profileCount,
    consentCount,
    messageCounts,
    recentMessages,
    flows,
    segments,
    campaigns,
    templates,
    queueHealth,
    reports,
    postmarkUsage,
  ] = await Promise.all([
    db("gp_customer_profile").whereNull("deleted_at").count({ count: "*" }).first(),
    db("gp_customer_profile")
      .whereNull("deleted_at")
      .where("email_consent", true)
      .count({ count: "*" })
      .first(),
    db("gp_message_log")
      .whereNull("deleted_at")
      .select("status")
      .count({ count: "*" })
      .groupBy("status"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .select(
        "id",
        "email",
        "subject",
        "template_key",
        "message_stream",
        "message_purpose",
        "status",
        "sent_at",
        "created_at",
        "order_id",
        "campaign_id",
        "flow_key"
      )
      .orderBy("created_at", "desc")
      .limit(15),
    db("gp_communication_flow")
      .whereNull("deleted_at")
      .select(
        "id",
        "key",
        "name",
        "status",
        "message_stream",
        "message_purpose",
        "trigger_event"
      )
      .orderBy("name", "asc"),
    db("gp_segment")
      .whereNull("deleted_at")
      .select("id", "key", "name", "description", "cached_count", "status")
      .orderBy("name", "asc"),
    db("gp_campaign")
      .whereNull("deleted_at")
      .select("id", "name", "status", "subject", "segment_key", "sent_at", "scheduled_at")
      .orderBy("created_at", "desc")
      .limit(10),
    listEmailTemplates(db),
    communicationQueueHealth(),
    communicationReporting(db, 30),
    postmarkUsageSummary(db),
  ])

  const statusCounts = Object.fromEntries(
    messageCounts.map((row: Record<string, any>) => [row.status, Number(row.count || 0)])
  )

  return {
    metrics: {
      profiles: Number(profileCount?.count || 0),
      consented: Number(consentCount?.count || 0),
      messages_sent: statusCounts.sent || 0,
      messages_delivered: statusCounts.delivered || 0,
      messages_failed: statusCounts.failed || 0,
      messages_bounced: statusCounts.bounced || 0,
      active_flows: flows.filter((flow: any) => flow.status === "active").length,
      segments: segments.length,
      attributed_orders: reports.metrics.attributed_orders,
      attributed_revenue: reports.metrics.attributed_revenue,
      abandoned_carts: reports.metrics.abandoned_carts,
      recovered_carts: reports.metrics.recovered_carts,
    },
    recent_messages: recentMessages,
    flows,
    segments,
    campaigns,
    templates,
    queue: queueHealth,
    reports,
    postmark_usage: postmarkUsage,
  }
}

export async function searchCommunicationProfiles(
  container: MedusaContainer,
  input: { q?: string; limit?: number; offset?: number }
) {
  const db = dbFrom(container)
  const limit = Math.min(100, Math.max(1, Number(input.limit || 25)))
  const offset = Math.max(0, Number(input.offset || 0))
  const q = String(input.q || "").trim()
  let query = db("gp_customer_profile")
    .whereNull("deleted_at")
    .select(
      "id",
      "medusa_customer_id",
      "email",
      "first_name",
      "last_name",
      "customer_type",
      "route_market",
      "lifecycle_stage",
      "total_orders",
      "total_revenue",
      "last_order_at",
      "last_active_at",
      "email_consent",
      "preferences"
    )
    .orderBy("last_active_at", "desc")
    .limit(limit)
    .offset(offset)

  if (q) {
    query = query.andWhere((builder: any) => {
      builder
        .whereILike("email", `%${q}%`)
        .orWhereILike("first_name", `%${q}%`)
        .orWhereILike("last_name", `%${q}%`)
        .orWhereILike("medusa_customer_id", `%${q}%`)
    })
  }

  const profiles = await query
  return { profiles, limit, offset }
}

export async function communicationProfileTimeline(
  container: MedusaContainer,
  profileId: string
) {
  const db = dbFrom(container)
  const profile = await db("gp_customer_profile")
    .whereNull("deleted_at")
    .where("id", profileId)
    .first()
  if (!profile) return null

  const [events, messages, segments] = await Promise.all([
    db("gp_communication_event")
      .whereNull("deleted_at")
      .where("profile_id", profileId)
      .select("*")
      .orderBy("occurred_at", "desc")
      .limit(100),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("profile_id", profileId)
      .select("*")
      .orderBy("created_at", "desc")
      .limit(50),
    db("gp_segment_member")
      .leftJoin("gp_segment", "gp_segment_member.segment_id", "gp_segment.id")
      .whereNull("gp_segment_member.deleted_at")
      .whereNull("gp_segment_member.exited_at")
      .where("gp_segment_member.profile_id", profileId)
      .select(
        "gp_segment.key",
        "gp_segment.name",
        "gp_segment_member.entered_at"
      ),
  ])

  return { profile, events, messages, segments }
}

async function eventProfileIds(
  db: KnexLike,
  definition: Record<string, any>
): Promise<string[]> {
  const days = Number(definition.days || 90)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  if (definition.viewed_holiday) {
    const viewed = await db("gp_communication_event")
      .whereNull("deleted_at")
      .whereNotNull("profile_id")
      .where("event_name", "product_viewed")
      .where("occurred_at", ">=", since)
      .whereRaw("properties ->> 'holiday' = ?", [definition.viewed_holiday])
      .distinct("profile_id")

    const purchased = definition.not_purchased_holiday
      ? await db("gp_communication_event")
          .whereNull("deleted_at")
          .whereNotNull("profile_id")
          .where("event_name", "order_completed")
          .whereRaw("properties ->> 'holiday' = ?", [
            definition.not_purchased_holiday,
          ])
          .distinct("profile_id")
      : []

    const purchasedIds = new Set(
      purchased.map((row: Record<string, any>) => row.profile_id)
    )
    return viewed
      .map((row: Record<string, any>) => row.profile_id)
      .filter((profileId: string) => !purchasedIds.has(profileId))
  }

  if (definition.holiday) {
    const rows = await db("gp_communication_event")
      .whereNull("deleted_at")
      .whereNotNull("profile_id")
      .where("event_name", "order_completed")
      .where("occurred_at", ">=", since)
      .whereRaw("properties ->> 'holiday' = ?", [definition.holiday])
      .select("profile_id")
      .count({ count: "*" })
      .groupBy("profile_id")
      .havingRaw("count(*) >= ?", [Number(definition.min_orders || 1)])

    return rows.map((row: Record<string, any>) => row.profile_id)
  }

  if (!definition.event) return []

  const eventRows = await db("gp_communication_event")
    .whereNull("deleted_at")
    .whereNotNull("profile_id")
    .where("event_name", definition.event)
    .where("occurred_at", ">=", since)
    .distinct("profile_id")

  let profileIds = eventRows.map((row: Record<string, any>) => row.profile_id)

  if (definition.missing_event && profileIds.length) {
    const completionRows = await db("gp_communication_event")
      .whereNull("deleted_at")
      .whereNotNull("profile_id")
      .where("event_name", definition.missing_event)
      .where("occurred_at", ">=", since)
      .whereIn("profile_id", profileIds)
      .distinct("profile_id")

    const completed = new Set(
      completionRows.map((row: Record<string, any>) => row.profile_id)
    )
    profileIds = profileIds.filter((profileId: string) => !completed.has(profileId))
  }

  return profileIds
}

async function profilesForDefinition(
  db: KnexLike,
  definition: Record<string, any>,
  opts: { requireConsent?: boolean; limit?: number } = {}
) {
  let query = db("gp_customer_profile")
    .whereNull("deleted_at")
    .whereNotNull("email")

  if (opts.requireConsent !== false) {
    query = query.where("email_consent", true)
  }

  if (definition.customer_type) query = query.where("customer_type", definition.customer_type)
  if (definition.route_market) query = query.where("route_market", definition.route_market)
  if (Array.isArray(definition.route_market_in)) {
    query = query.whereIn("route_market", definition.route_market_in)
  }
  if (definition.lifecycle_stage) query = query.where("lifecycle_stage", definition.lifecycle_stage)
  if (definition.total_orders_gte) query = query.where("total_orders", ">=", definition.total_orders_gte)
  if (definition.total_orders) query = query.where("total_orders", definition.total_orders)
  if (definition.total_revenue_gte) query = query.where("total_revenue", ">=", definition.total_revenue_gte)
  if (definition.first_basket_size_lt) query = query.where("first_basket_size", "<", definition.first_basket_size_lt)
  if (definition.last_order_before_days) {
    query = query.where(
      "last_order_at",
      "<",
      new Date(Date.now() - Number(definition.last_order_before_days) * 24 * 60 * 60 * 1000)
    )
  }
  if (
    definition.event ||
    definition.holiday ||
    definition.viewed_holiday ||
    definition.not_purchased_holiday
  ) {
    const profileIds = await eventProfileIds(db, definition)
    query = query.whereIn("id", profileIds.length ? profileIds : ["__none__"])
  }

  return query.limit(opts.limit || 1000)
}

async function audienceForSegment(db: KnexLike, segmentKey?: string | null) {
  if (!segmentKey) {
    return profilesForDefinition(db, {}, { requireConsent: true, limit: 1000 })
  }

  const segment = await db("gp_segment")
    .whereNull("deleted_at")
    .where("key", segmentKey)
    .first()

  if (!segment) return []
  return profilesForDefinition(db, segment.query_definition || {}, {
    requireConsent: true,
    limit: 1000,
  })
}

export async function createCampaign(
  container: MedusaContainer,
  input: {
    name: string
    subject: string
    segment_key?: string | null
    body?: string | null
    intro?: string | null
    cta_label?: string | null
    cta_url?: string | null
    scheduled_at?: string | null
    approved_by?: string | null
  }
) {
  const db = dbFrom(container)
  const scheduledAt = input.scheduled_at ? new Date(input.scheduled_at) : null
  const row = {
    id: id("gpcamp"),
    key: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name: input.name,
    subject: input.subject,
    segment_key: input.segment_key || null,
    template_key: "campaign-simple",
    status:
      scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? "scheduled" : "draft",
    scheduled_at:
      scheduledAt && !Number.isNaN(scheduledAt.getTime()) ? scheduledAt : null,
    approved_by: input.approved_by || null,
    metadata: {
      intro: input.intro || "",
      body: input.body || "",
      cta_label: input.cta_label || "Shop now",
      cta_url: input.cta_url || "/us/store",
    },
    created_at: now(),
    updated_at: now(),
  }
  await db("gp_campaign").insert(row)
  if (row.scheduled_at) {
    await enqueueCampaignSend(row.id, {
      delay_ms: Math.max(0, row.scheduled_at.getTime() - Date.now()),
    })
  }
  return row
}

export async function sendCampaign(
  container: MedusaContainer,
  campaignId: string,
  opts: { test_email?: string | null; approved_by?: string | null } = {}
) {
  const db = dbFrom(container)
  const campaign = await db("gp_campaign")
    .whereNull("deleted_at")
    .where("id", campaignId)
    .first()
  if (!campaign) throw new Error("Campaign not found.")
  if (!opts.test_email && campaign.status === "sent") {
    return {
      sent: 0,
      skipped: 0,
      failed: 0,
      audience_count: 0,
      already_sent: true,
    }
  }

  const metadata = campaign.metadata || {}
  const audience = opts.test_email
    ? [{ email: opts.test_email, id: null, first_name: "" }]
    : await audienceForSegment(db, campaign.segment_key)

  const snapshot = audience.map((profile: Record<string, any>) => ({
    profile_id: profile.id || null,
    email: profile.email,
  }))

  let sent = 0
  let skipped = 0
  let failed = 0
  for (const profile of audience) {
    const email = buildSimpleMessageEmail({
      subject: campaign.subject,
      eyebrow: "Griller's Pride",
      heading: campaign.subject,
      intro: metadata.intro || undefined,
      paragraphs: String(metadata.body || "")
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean),
      ctaLabel: metadata.cta_label || "Shop now",
      ctaUrl: metadata.cta_url || "/us/store",
    })
    const result = await sendTrackedEmail(container, {
      to: profile.email,
      stream: "broadcast",
      purpose: "broadcast",
      template_key: "campaign-simple",
      subject: email.subject,
      html: email.html,
      text: email.text,
      topic: "promotions",
      campaign_id: campaign.id,
      profile_id: profile.id || null,
      medusa_customer_id: profile.medusa_customer_id || null,
      idempotency_key: opts.test_email
        ? `campaign-test:${campaign.id}:${normalizeEmail(profile.email)}:${Date.now()}`
        : `campaign:${campaign.id}:${normalizeEmail(profile.email)}`,
      template_model: {
        first_name: profile.first_name || "",
        email: profile.email,
      },
    })
    if (result.ok && result.skipped) skipped += 1
    else if (result.ok) sent += 1
    else failed += 1
  }

  if (!opts.test_email) {
    await db("gp_campaign").where("id", campaign.id).update({
      status: "sent",
      sent_at: now(),
      approved_by: opts.approved_by || campaign.approved_by,
      approved_at: campaign.approved_at || now(),
      audience_snapshot: snapshot,
      metrics: { sent, skipped, failed },
      updated_at: now(),
    })
  }

  await recordCommunicationEvent(db, {
    event_name: opts.test_email ? "campaign_test_sent" : "campaign_sent",
    campaign_id: campaign.id,
    source: "admin",
    properties: { sent, skipped, failed, test_email: opts.test_email || null },
  })

  return { sent, skipped, failed, audience_count: audience.length }
}

export async function sendStaffMessage(
  container: MedusaContainer,
  input: {
    to: string
    subject: string
    heading?: string
    body: string
    stream?: CommunicationStream
    topic?: string
    order_id?: string | null
    profile_id?: string | null
    staff_actor_email?: string | null
  }
) {
  const email = buildSimpleMessageEmail({
    subject: input.subject,
    eyebrow: "Griller's Pride",
    heading: input.heading || input.subject,
    paragraphs: input.body
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean),
    ctaLabel: input.order_id ? "View order" : "Shop Griller's Pride",
    ctaUrl: input.order_id ? `/us/account/orders/details/${input.order_id}` : "/us/store",
  })

  return sendTrackedEmail(container, {
    to: input.to,
    stream: input.stream || "transactional",
    purpose:
      input.stream === "broadcast"
        ? "broadcast"
        : input.stream === "lifecycle"
        ? "marketing_1to1"
        : "service",
    template_key: "staff-message",
    subject: email.subject,
    html: email.html,
    text: email.text,
    topic: input.topic || "order_updates",
    order_id: input.order_id || null,
    profile_id: input.profile_id || null,
    idempotency_key: `staff-message:${normalizeEmail(input.to)}:${Date.now()}`,
    metadata: { staff_actor_email: input.staff_actor_email || null },
  })
}

export async function runCommunicationMaintenance(container: MedusaContainer) {
  const db = dbFrom(container)
  await seedCommunicationDefaults(db)
  await seedEmailTemplates(db)
  const carts = await expireInactiveCarts(container)
  const segments = await refreshSegmentMembership(container)
  const campaigns = await sendDueScheduledCampaigns(container)
  const result = await runDueFlowEnrollments(container, 100)
  return { ...result, segments, carts, campaigns }
}

export async function communicationReports(container: MedusaContainer, days = 30) {
  return communicationReporting(dbFrom(container), days)
}

export async function communicationTemplates(container: MedusaContainer) {
  return { templates: await listEmailTemplates(dbFrom(container)) }
}

export async function sendDueScheduledCampaigns(container: MedusaContainer) {
  const db = dbFrom(container)
  const due = await db("gp_campaign")
    .whereNull("deleted_at")
    .where("status", "scheduled")
    .where("scheduled_at", "<=", now())
    .orderBy("scheduled_at", "asc")
    .limit(25)

  const results: Array<Record<string, any>> = []
  for (const campaign of due) {
    results.push({
      campaign_id: campaign.id,
      ...(await sendCampaign(container, campaign.id)),
    })
  }

  return { processed: due.length, results }
}

export async function refreshProfileLifecycle(container: MedusaContainer) {
  const db = dbFrom(container)
  const profiles = await db("gp_customer_profile")
    .whereNull("deleted_at")
    .select("*")
    .limit(5000)

  let updated = 0
  for (const profile of profiles) {
    const totalOrders = money(profile.total_orders)
    const totalRevenue = money(profile.total_revenue)
    const lastOrderAt = profile.last_order_at ? new Date(profile.last_order_at) : null
    const daysSinceOrder = lastOrderAt
      ? (Date.now() - lastOrderAt.getTime()) / (24 * 60 * 60 * 1000)
      : null
    const previous = profile.lifecycle_stage
    let lifecycle = "lead"
    if (totalOrders <= 0) lifecycle = "lead"
    else if (totalOrders === 1 && daysSinceOrder !== null && daysSinceOrder <= 30) lifecycle = "new"
    else if (totalOrders >= 5 || totalRevenue >= 500) lifecycle = "loyal"
    else if (daysSinceOrder !== null && daysSinceOrder > 120) lifecycle = "churned"
    else if (daysSinceOrder !== null && daysSinceOrder > 60) lifecycle = "at_risk"
    else lifecycle = "active"

    const recencyScore =
      daysSinceOrder === null ? 0 : Math.max(0, Math.min(100, 100 - daysSinceOrder * (100 / 180)))
    const frequencyScore = Math.min(100, totalOrders * 10)
    const monetaryScore = Math.min(100, totalRevenue / 10)
    const engagementScore = Math.round(recencyScore * 0.3 + frequencyScore * 0.3 + monetaryScore * 0.2)

    if (previous !== lifecycle || Number(profile.engagement_score || 0) !== engagementScore) {
      await db("gp_customer_profile").where("id", profile.id).update({
        lifecycle_stage: lifecycle,
        engagement_score: engagementScore,
        updated_at: now(),
      })
      updated += 1
      if (previous !== lifecycle) {
        await recordCommunicationEvent(db, {
          event_name: "lifecycle_stage_changed",
          profile_id: profile.id,
          email: profile.email,
          properties: {
            previous_lifecycle_stage: previous,
            lifecycle_stage: lifecycle,
            last_order_at: dateIso(profile.last_order_at),
          },
        })
      }
    }
  }

  return { updated }
}

export async function refreshSegmentMembership(container: MedusaContainer) {
  const db = dbFrom(container)
  await seedCommunicationDefaults(db)
  const segments = await db("gp_segment")
    .whereNull("deleted_at")
    .where("status", "active")
    .select("*")

  let refreshed = 0
  let activeMembers = 0

  for (const segment of segments) {
    const profiles = await profilesForDefinition(
      db,
      segment.query_definition || {},
      { requireConsent: false, limit: 10000 }
    )
    const profileIds = new Set(
      profiles.map((profile: Record<string, any>) => profile.id).filter(Boolean)
    )
    activeMembers += profileIds.size

    const existingRows = await db("gp_segment_member")
      .whereNull("deleted_at")
      .whereNull("exited_at")
      .where("segment_id", segment.id)
      .select("id", "profile_id")

    const existingByProfile = new Map(
      existingRows.map((row: Record<string, any>) => [row.profile_id, row])
    )

    for (const profileId of profileIds) {
      if (existingByProfile.has(profileId)) continue
      await db("gp_segment_member").insert({
        id: id("gpsegmem"),
        segment_id: segment.id,
        profile_id: profileId,
        entered_at: now(),
        metadata: {},
        created_at: now(),
        updated_at: now(),
      })
    }

    for (const row of existingRows) {
      if (profileIds.has(row.profile_id)) continue
      await db("gp_segment_member").where("id", row.id).update({
        exited_at: now(),
        updated_at: now(),
      })
    }

    await db("gp_segment").where("id", segment.id).update({
      cached_count: profileIds.size,
      last_computed_at: now(),
      updated_at: now(),
    })
    refreshed += 1
  }

  return { refreshed, active_members: activeMembers }
}
