import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buildSimpleMessageEmail } from "../emails/templates/simple-message"
import {
  recordCommunicationEvent,
  sendTrackedEmail,
  type CommunicationPurpose,
  type CommunicationStream,
} from "./core"
import {
  isInSendBlackout,
  nextAllowedSendTime,
  resolveCalendarAnchor,
} from "./hebrew-calendar"

type KnexLike = any

type FlowStep =
  | { type: "delay"; minutes?: number; days?: number }
  | {
      type: "email"
      template_key: string
      subject: string
      heading: string
      intro?: string
      paragraphs?: string[]
      ctaLabel?: string
      ctaUrl?: string
      topic?: string
      stream?: CommunicationStream
      purpose?: CommunicationPurpose
    }
  | {
      type: "sms"
      template_key: string
      /** Plain text; {{first_name}} interpolates from the profile. */
      body: string
      topic?: string
      stream?: CommunicationStream
      purpose?: CommunicationPurpose
    }
  | {
      type: "exit_if_event"
      event_name: string
      days_since_enrollment?: number
      same_cart?: boolean
      same_order?: boolean
    }

const now = () => new Date()
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const jsonb = (value: unknown) => JSON.stringify(value ?? {})

const PREBUILT_SEGMENTS = [
  {
    key: "vip_customers",
    name: "VIP Customers",
    description: "At least $500 lifetime revenue and 5+ orders.",
    query_definition: { total_revenue_gte: 500, total_orders_gte: 5 },
  },
  {
    key: "at_risk_customers",
    name: "At-Risk Customers",
    description: "Previously active customers with no recent order.",
    query_definition: { lifecycle_stage: "at_risk" },
  },
  {
    key: "cart_abandoners_7d",
    name: "Cart Abandoners (7d)",
    description: "Checkout/cart activity without a completed order in 7 days.",
    query_definition: { event: "checkout_started", missing_event: "order_completed", days: 7 },
  },
  {
    key: "new_subscribers",
    name: "New Subscribers",
    description: "Email subscribers who have not purchased yet.",
    query_definition: { lifecycle_stage: "lead", email_consent: true },
  },
  {
    key: "shabbos_regulars",
    name: "Shabbos Regulars",
    description: "Customers with repeated Shabbos-associated orders.",
    query_definition: { holiday: "shabbos", min_orders: 3, days: 90 },
  },
  {
    key: "pesach_prospects",
    name: "Pesach Prospects",
    description: "Customers who viewed Pesach items and have not purchased Pesach.",
    query_definition: { viewed_holiday: "pesach", not_purchased_holiday: "pesach" },
  },
  {
    key: "b2b_institutional",
    name: "B2B Institutional",
    description: "Institutional/wholesale customer profiles.",
    query_definition: { customer_type: "institutional" },
  },
  {
    key: "core_delivery_b2c",
    name: "Core Delivery B2C",
    description: "DTC customers in the core delivery market.",
    query_definition: { customer_type: "dtc", route_market: "core" },
  },
  {
    key: "national_b2c",
    name: "National B2C",
    description: "DTC customers outside local delivery markets.",
    query_definition: { customer_type: "dtc", route_market_in: ["national", "scheduled_pod"] },
  },
  {
    key: "first_basket_risk",
    name: "First-Basket < 4 Items",
    description: "First-time buyers whose first basket predicts weaker retention.",
    query_definition: { total_orders: 1, first_basket_size_lt: 4 },
  },
  {
    key: "dormant_181d",
    name: "Dormant (181+ days)",
    description: "Customers with order history but no recent order.",
    query_definition: { last_order_before_days: 181, total_orders_gte: 1 },
  },
]

const PREBUILT_FLOWS: Array<{
  key: string
  name: string
  description: string
  trigger_event?: string
  trigger_conditions?: Record<string, any>
  message_stream: CommunicationStream
  message_purpose?: CommunicationPurpose
  steps: FlowStep[]
}> = [
  {
    key: "welcome_series",
    name: "Welcome Series",
    description: "New subscriber welcome and first-order nudge.",
    trigger_event: "email_signup",
    message_stream: "lifecycle",
    steps: [
      {
        type: "email",
        template_key: "welcome-1",
        subject: "Welcome to Griller's Pride",
        heading: "Welcome to Griller's Pride",
        intro: "Kosher meat, cut with care and packed for how families actually cook.",
        paragraphs: [
          "We will keep email useful: order reminders, holiday timing, new cuts, and a little cooking help when it matters.",
          "Start with best sellers if you are planning a first order.",
        ],
        ctaLabel: "Shop best sellers",
        ctaUrl: "/us/store",
        topic: "promotions",
      },
      { type: "delay", days: 3 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "welcome-2",
        subject: "The cuts customers come back for",
        heading: "Build a better first basket",
        paragraphs: [
          "Customers who build a four-plus item first basket are much more likely to reorder.",
          "Chicken, brisket, lamb, and freezer staples are the best place to start.",
        ],
        ctaLabel: "Browse collections",
        ctaUrl: "/us/collections",
        topic: "promotions",
      },
      { type: "delay", days: 5 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "welcome-3",
        subject: "Planning your first Griller's Pride order",
        heading: "Planning your first order",
        paragraphs: [
          "A good first cart usually mixes dinner staples, freezer backups, and one cut for a specific meal.",
          "Reply if you want help choosing pack sizes or delivery timing.",
        ],
        ctaLabel: "Start an order",
        ctaUrl: "/us/store",
        topic: "promotions",
      },
    ],
  },
  {
    key: "cart_abandon_b2c",
    name: "B2C Cart Abandonment",
    description: "Recover expired DTC carts without sounding desperate.",
    trigger_event: "gp_cart_expired",
    trigger_conditions: { customer_type: "dtc" },
    message_stream: "transactional",
    message_purpose: "marketing_1to1",
    steps: [
      { type: "delay", minutes: 60 },
      { type: "exit_if_event", event_name: "order_completed", same_cart: true },
      {
        type: "email",
        template_key: "cart-abandoned-b2c-1",
        subject: "Your Griller's Pride cart is still here",
        heading: "Your cart is still here",
        paragraphs: [
          "If you were planning for Shabbos, Yom Tov, or freezer stock, your cart can still save time.",
          "Inventory can change, so check out while the cuts are still available.",
        ],
        ctaLabel: "Return to cart",
        ctaUrl: "/us/cart",
        topic: "cart_recovery",
      },
      { type: "delay", days: 1 },
      { type: "exit_if_event", event_name: "order_completed", same_cart: true },
      {
        type: "email",
        template_key: "cart-abandoned-b2c-2",
        subject: "Need help finishing your order?",
        heading: "Need help finishing your order?",
        paragraphs: [
          "Reply to this email if something in checkout was unclear or if you need help choosing substitutions.",
        ],
        ctaLabel: "Open cart",
        ctaUrl: "/us/cart",
        topic: "cart_recovery",
      },
      { type: "delay", days: 2 },
      { type: "exit_if_event", event_name: "order_completed", same_cart: true },
      {
        type: "email",
        template_key: "cart-abandoned-b2c-3",
        subject: "Last reminder about your cart",
        heading: "Last reminder about your cart",
        paragraphs: [
          "We will stop reminding you after this note. If you still want these items, your cart is the fastest way back.",
        ],
        ctaLabel: "Return to cart",
        ctaUrl: "/us/cart",
        topic: "cart_recovery",
      },
    ],
  },
  {
    key: "cart_abandon_b2b",
    name: "B2B Cart Abandonment",
    description: "Professional no-discount reminder for institutional customers.",
    trigger_event: "gp_cart_expired",
    trigger_conditions: { customer_type: "institutional" },
    message_stream: "transactional",
    message_purpose: "marketing_1to1",
    steps: [
      { type: "delay", minutes: 120 },
      { type: "exit_if_event", event_name: "order_completed", same_cart: true },
      {
        type: "email",
        template_key: "cart-abandoned-b2b-1",
        subject: "Your Griller's Pride order is ready to review",
        heading: "Your order is ready to review",
        paragraphs: [
          "Your draft order is still available. Reply if you need pack-size, standing-order, or delivery help.",
        ],
        ctaLabel: "Review order",
        ctaUrl: "/us/cart",
        topic: "cart_recovery",
      },
    ],
  },
  {
    key: "post_purchase",
    name: "Post-Purchase",
    description: "Review, cross-sell, and restock reminders after an order.",
    trigger_event: "order_completed",
    message_stream: "lifecycle",
    steps: [
      { type: "delay", days: 7 },
      {
        type: "email",
        template_key: "post-purchase-review",
        subject: "How was your order?",
        heading: "How was your order?",
        paragraphs: [
          "If everything arrived as expected, we would appreciate a short review.",
          "If something was off, reply here and we will help directly.",
        ],
        ctaLabel: "Shop again",
        ctaUrl: "/us/account/reorder",
        topic: "reviews",
      },
      { type: "delay", days: 7 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "first-basket-expansion",
        subject: "A few easy additions for next time",
        heading: "A few easy additions for next time",
        paragraphs: [
          "If your first order was mostly one category, adding a freezer staple or Shabbos-ready cut can make the next order more useful.",
        ],
        ctaLabel: "Browse staples",
        ctaUrl: "/us/collections",
        topic: "promotions",
      },
      { type: "delay", days: 14 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "reorder-reminder",
        subject: "Time to restock?",
        heading: "Time to restock?",
        paragraphs: [
          "A lot of customers reorder before the freezer is empty. Your account can rebuild a cart from past purchases.",
        ],
        ctaLabel: "Reorder",
        ctaUrl: "/us/account/reorder",
        topic: "promotions",
      },
    ],
  },
  {
    key: "second_order_loyalty",
    name: "Post-Second-Order Loyalty",
    description: "Acknowledge customers after the second order.",
    trigger_event: "order_completed",
    trigger_conditions: { total_orders: 2 },
    message_stream: "lifecycle",
    steps: [
      { type: "delay", days: 3 },
      {
        type: "email",
        template_key: "loyalty-welcome",
        subject: "Thanks for ordering again",
        heading: "Thanks for ordering again",
        paragraphs: [
          "A second order tells us you are figuring out what works in your kitchen.",
          "Your account can help you reorder usuals and branch into new categories.",
        ],
        ctaLabel: "Open reorder hub",
        ctaUrl: "/us/account/reorder",
        topic: "promotions",
      },
    ],
  },
  {
    key: "winback_at_risk",
    name: "At-Risk Win-Back",
    description: "Bring active customers back before they go dormant.",
    trigger_event: "lifecycle_stage_changed",
    trigger_conditions: { lifecycle_stage: "at_risk" },
    message_stream: "lifecycle",
    steps: [
      {
        type: "email",
        template_key: "winback-1",
        subject: "Still cooking with Griller's Pride?",
        heading: "Still cooking with Griller's Pride?",
        paragraphs: [
          "It has been a little while since your last order. If you need help finding a cut or planning for a delivery window, reply here.",
        ],
        ctaLabel: "Restock",
        ctaUrl: "/us/account/reorder",
        topic: "promotions",
      },
      { type: "delay", days: 7 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "winback-2",
        subject: "Can we help with your next order?",
        heading: "Can we help with your next order?",
        paragraphs: [
          "If timing, availability, or pack size has been the blocker, reply here and a person can help.",
        ],
        ctaLabel: "Open reorder hub",
        ctaUrl: "/us/account/reorder",
        topic: "promotions",
      },
    ],
  },
  {
    key: "dormant_reactivation",
    name: "Dormant Reactivation",
    description: "Useful reactivation note for long-dormant customers.",
    trigger_event: "lifecycle_stage_changed",
    trigger_conditions: { lifecycle_stage: "churned" },
    message_stream: "lifecycle",
    steps: [
      {
        type: "email",
        template_key: "reactivation-1",
        subject: "A lot has changed at Griller's Pride",
        heading: "A lot has changed",
        paragraphs: [
          "The new site is easier to reorder from, and product pages now give clearer pack, pickup, and shipping information.",
        ],
        ctaLabel: "See what is new",
        ctaUrl: "/us/store",
        topic: "promotions",
      },
      { type: "delay", days: 14 },
      { type: "exit_if_event", event_name: "order_completed" },
      {
        type: "email",
        template_key: "reactivation-2",
        subject: "Your old favorites are easier to reorder",
        heading: "Your old favorites are easier to reorder",
        paragraphs: [
          "The reorder area can rebuild a cart from past purchases, and the staff team can help if a legacy item looks different on the new site.",
        ],
        ctaLabel: "Reorder favorites",
        ctaUrl: "/us/account/reorder",
        topic: "promotions",
      },
    ],
  },
  {
    key: "back_in_stock_waitlist",
    name: "Back-In-Stock Waitlist",
    description: "Notify customers when an active, waitlist-eligible item returns.",
    trigger_event: "back_in_stock",
    message_stream: "lifecycle",
    steps: [
      {
        type: "email",
        template_key: "back-in-stock",
        subject: "This item is back in stock",
        heading: "This item is back in stock",
        paragraphs: [
          "The item you asked about is available again. Availability can still move quickly, so order soon if you need it.",
        ],
        ctaLabel: "Shop the item",
        ctaUrl: "/us/store",
        topic: "back_in_stock",
      },
    ],
  },
  {
    key: "holiday_reminder",
    name: "Holiday and Shabbos Reminder",
    description: "Segment-safe reminder for seasonal planning and delivery timing.",
    trigger_event: "holiday_reminder_due",
    message_stream: "lifecycle",
    steps: [
      {
        type: "email",
        template_key: "holiday-reminder",
        subject: "Plan your Griller's Pride order",
        heading: "Plan your order",
        paragraphs: [
          "If you are planning meals around a holiday, Shabbos, or a delivery route, ordering early gives the team more room to pack accurately.",
        ],
        ctaLabel: "Plan an order",
        ctaUrl: "/us/store",
        topic: "holiday_reminders",
      },
    ],
  },
]

function conditionMatches(
  conditions: Record<string, any> | null | undefined,
  event: Record<string, any>,
  profile?: Record<string, any> | null
) {
  if (!conditions || !Object.keys(conditions).length) return true
  const props = event.properties || {}
  return Object.entries(conditions).every(([key, value]) => {
    if (key === "customer_type") {
      return (event.customer_type || profile?.customer_type) === value
    }
    if (key === "lifecycle_stage") {
      return (props.lifecycle_stage || profile?.lifecycle_stage) === value
    }
    if (key === "total_orders") {
      return Number(profile?.total_orders || props.total_orders || 0) === Number(value)
    }
    return props[key] === value || event[key] === value
  })
}

export async function seedCommunicationDefaults(db: KnexLike) {
  for (const segment of PREBUILT_SEGMENTS) {
    const existing = await db("gp_segment")
      .whereNull("deleted_at")
      .where("key", segment.key)
      .first()
    if (existing) {
      await db("gp_segment").where("id", existing.id).update({
        ...segment,
        query_definition: jsonb(segment.query_definition),
        status: "active",
        updated_at: now(),
      })
    } else {
      await db("gp_segment").insert({
        id: id("gpseg"),
        ...segment,
        query_definition: jsonb(segment.query_definition),
        status: "active",
        cached_count: 0,
        created_at: now(),
        updated_at: now(),
      })
    }
  }

  for (const flow of PREBUILT_FLOWS) {
    const existing = await db("gp_communication_flow")
      .whereNull("deleted_at")
      .where("key", flow.key)
      .first()
    const payload = {
      key: flow.key,
      name: flow.name,
      description: flow.description,
      trigger_event: flow.trigger_event || null,
      trigger_conditions: jsonb(flow.trigger_conditions || {}),
      steps: jsonb(flow.steps),
      status: "active",
      message_stream: flow.message_stream,
      message_purpose:
        flow.message_purpose ||
        (flow.message_stream === "broadcast"
          ? "broadcast"
          : flow.message_stream === "transactional"
          ? "transactional"
          : "marketing_1to1"),
      updated_at: now(),
    }
    if (existing) {
      await db("gp_communication_flow").where("id", existing.id).update(payload)
    } else {
      await db("gp_communication_flow").insert({
        id: id("gpflow"),
        ...payload,
        created_at: now(),
      })
    }
  }
}

/**
 * Deterministic holdout assignment: sha1(profile:flow) % 100. Stable across
 * re-enrollments (a customer is ALWAYS control or ALWAYS treated for a
 * given flow — no contamination), independent across flows, and needs no
 * stored coin-flips. Default 10%; per-flow override via
 * flow.metadata.holdout_pct; COMMS_FLOW_HOLDOUT_PCT for the platform.
 */
export function isHoldout(profileId: string, flow: Record<string, any>): boolean {
  const pct = Number(
    flow?.metadata?.holdout_pct ?? process.env.COMMS_FLOW_HOLDOUT_PCT ?? 10
  )
  if (!Number.isFinite(pct) || pct <= 0) return false
  const digest = crypto
    .createHash("sha1")
    .update(`${profileId}:${flow.key}`)
    .digest()
  const bucket = digest.readUInt16BE(0) % 100
  return bucket < Math.min(pct, 100)
}

async function enrollProfileInFlow(
  db: KnexLike,
  flow: Record<string, any>,
  profileId: string,
  triggerEventId: string,
  triggerContext: Record<string, any>
): Promise<boolean> {
  const existing = await db("gp_flow_enrollment")
    .whereNull("deleted_at")
    .where("flow_key", flow.key)
    .where("profile_id", profileId)
    .where("trigger_event_id", triggerEventId)
    .first()
  if (existing) return false

  const holdout = isHoldout(profileId, flow)
  await db("gp_flow_enrollment").insert({
    id: id("gpenroll"),
    flow_id: flow.id,
    flow_key: flow.key,
    profile_id: profileId,
    trigger_event_id: triggerEventId,
    trigger_context: triggerContext,
    current_step_index: 0,
    status: "active",
    enrolled_at: now(),
    next_action_at: now(),
    metadata: holdout ? { holdout: true } : {},
    created_at: now(),
    updated_at: now(),
  })
  if (holdout) {
    await recordCommunicationEvent(db, {
      event_name: "flow_holdout_assigned",
      profile_id: profileId,
      flow_id: flow.id,
      properties: { flow_key: flow.key, trigger_event_id: triggerEventId },
    })
  }
  return true
}

export async function evaluateFlowsForEvent(
  db: KnexLike,
  event: Record<string, any>
) {
  if (!event.profile_id || String(event.event_name).startsWith("email_")) {
    return
  }
  await seedCommunicationDefaults(db)

  const profile = await db("gp_customer_profile")
    .whereNull("deleted_at")
    .where("id", event.profile_id)
    .first()

  const flows = await db("gp_communication_flow")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("trigger_event", event.event_name)

  for (const flow of flows) {
    if (!conditionMatches(flow.trigger_conditions, event, profile)) continue
    await enrollProfileInFlow(db, flow, event.profile_id, event.event_id, event)
  }
}

/**
 * Calendar-anchored enrollment: flows with trigger_event = "calendar_anchor"
 * enroll an entire SEGMENT when the resolved date arrives ("6 weeks before
 * seder" → everyone in pesach-buyers). Runs from the maintenance runner;
 * the per-occurrence trigger id (flow key + hebrew year) makes each year's
 * enrollment idempotent across runner ticks. A 3-day catch-up window covers
 * runner downtime; holdouts apply exactly as with event triggers.
 */
export async function enrollCalendarAnchoredFlows(
  db: KnexLike
): Promise<{ evaluated: number; enrolled: number }> {
  const flows = await db("gp_communication_flow")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("trigger_event", "calendar_anchor")

  const summary = { evaluated: 0, enrolled: 0 }
  for (const flow of flows) {
    const cond = flow.trigger_conditions || {}
    const anchorName = cond.anchor
    const segmentKey = cond.segment_key
    if (!anchorName || !segmentKey) continue
    summary.evaluated += 1

    let resolved
    try {
      resolved = resolveCalendarAnchor(
        {
          anchor: anchorName,
          offsetDays: Number(cond.offset_days ?? cond.offsetDays ?? 0),
          fromErev: Boolean(cond.from_erev ?? cond.fromErev),
        },
        new Date()
      )
    } catch {
      continue
    }

    const today = new Date()
    const windowEnd = new Date(resolved.fireAt)
    windowEnd.setDate(windowEnd.getDate() + 3)
    if (today < resolved.fireAt || today > windowEnd) continue

    const occurrenceId = `${flow.key}:${resolved.holiday.hebrewYear}`
    const segment = await db("gp_segment")
      .whereNull("deleted_at")
      .where("key", segmentKey)
      .first()
    if (!segment) continue

    const members = await db("gp_segment_member")
      .whereNull("deleted_at")
      .whereNull("exited_at")
      .where("segment_id", segment.id)
      .select("profile_id")

    for (const member of members) {
      const enrolled = await enrollProfileInFlow(
        db,
        flow,
        member.profile_id,
        occurrenceId,
        {
          calendar_anchor: anchorName,
          segment_key: segmentKey,
          fire_at: resolved.fireAt.toISOString(),
          hebrew_year: resolved.holiday.hebrewYear,
        }
      )
      if (enrolled) summary.enrolled += 1
    }
  }
  return summary
}

async function hasExitEvent(
  db: KnexLike,
  enrollment: Record<string, any>,
  step: Extract<FlowStep, { type: "exit_if_event" }>
) {
  const trigger = enrollment.trigger_context || {}
  const query = db("gp_communication_event")
    .whereNull("deleted_at")
    .where("profile_id", enrollment.profile_id)
    .where("event_name", step.event_name)
    .where("occurred_at", ">=", enrollment.enrolled_at)
    .limit(1)

  if (step.same_cart && trigger.cart_id) {
    query.where("cart_id", trigger.cart_id)
  }
  if (step.same_order && trigger.order_id) {
    query.where("order_id", trigger.order_id)
  }

  const row = await query.first()
  return Boolean(row)
}

function delayDate(step: Extract<FlowStep, { type: "delay" }>) {
  const minutes = Number(step.minutes || 0) + Number(step.days || 0) * 24 * 60
  return new Date(Date.now() + Math.max(1, minutes) * 60 * 1000)
}

export async function runDueFlowEnrollments(
  container: MedusaContainer,
  limit = 50
): Promise<{ processed: number; sent: number; completed: number; errors: number }> {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await seedCommunicationDefaults(db)
  const due = await db("gp_flow_enrollment")
    .whereNull("deleted_at")
    .where("status", "active")
    .where("next_action_at", "<=", now())
    .orderBy("next_action_at", "asc")
    .limit(limit)

  const summary = { processed: 0, sent: 0, completed: 0, errors: 0 }

  for (const enrollment of due) {
    summary.processed += 1
    try {
      const flow = await db("gp_communication_flow")
        .whereNull("deleted_at")
        .where("id", enrollment.flow_id)
        .first()
      const profile = await db("gp_customer_profile")
        .whereNull("deleted_at")
        .where("id", enrollment.profile_id)
        .first()
      const steps = Array.isArray(flow?.steps) ? (flow.steps as FlowStep[]) : []
      const step = steps[Number(enrollment.current_step_index || 0)]

      if (!flow || !profile || !step) {
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          status: "completed",
          completed_at: now(),
          next_action_at: null,
          updated_at: now(),
        })
        summary.completed += 1
        continue
      }

      if (!profile.email) {
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          status: "exited",
          exited_at: now(),
          exit_reason: "missing_email",
          next_action_at: null,
          updated_at: now(),
        })
        summary.completed += 1
        continue
      }

      if (step.type === "delay") {
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          current_step_index: Number(enrollment.current_step_index || 0) + 1,
          next_action_at: delayDate(step),
          updated_at: now(),
        })
        continue
      }

      if (step.type === "exit_if_event") {
        const shouldExit = await hasExitEvent(db, enrollment, step)
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          current_step_index: Number(enrollment.current_step_index || 0) + 1,
          status: shouldExit ? "exited" : "active",
          exited_at: shouldExit ? now() : null,
          exit_reason: shouldExit ? `saw_${step.event_name}` : null,
          next_action_at: shouldExit ? null : now(),
          updated_at: now(),
        })
        if (shouldExit) summary.completed += 1
        continue
      }

      // HOLDOUT (control group): advance through message steps with the
      // exact same timing as the treated group but never send — the
      // recorded would-have-sent event is what the incremental-revenue
      // report divides against. Delay/exit steps ran identically above.
      if (enrollment.metadata?.holdout) {
        await recordCommunicationEvent(db, {
          event_name: "flow_message_holdout",
          profile_id: profile.id,
          email: profile.email,
          flow_id: flow.id,
          template_key: step.template_key,
          properties: {
            flow_key: flow.key,
            enrollment_id: enrollment.id,
            step_index: Number(enrollment.current_step_index || 0),
          },
        })
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          current_step_index: Number(enrollment.current_step_index || 0) + 1,
          next_action_at:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? null
              : now(),
          status:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? "completed"
              : "active",
          completed_at:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? now()
              : null,
          updated_at: now(),
        })
        continue
      }

      // Shabbat/Yom Tov blackout (platform rule): message steps are
      // RESCHEDULED — next_action_at moves past havdalah and the step
      // index does NOT advance, so nothing is skipped or lost. Delay and
      // exit steps above are state-only and process normally.
      {
        const blackout = isInSendBlackout(new Date())
        if (blackout.blocked) {
          await db("gp_flow_enrollment").where("id", enrollment.id).update({
            next_action_at: nextAllowedSendTime(new Date()),
            updated_at: now(),
          })
          continue
        }
      }

      // SMS steps: consent/quiet-hours/caps enforced inside sendTrackedSms;
      // deferred results (blackout or quiet hours) reschedule WITHOUT
      // advancing, exactly like the email path.
      if (step.type === "sms") {
        const { sendTrackedSms } = await import("./sms.js")
        const smsResult = await sendTrackedSms(container, {
          to: profile.phone,
          body: String(step.body || "").replace(
            /\{\{\s*first_name\s*\}\}/g,
            profile.first_name || "there"
          ),
          stream: step.stream || (flow.message_stream as CommunicationStream) || "lifecycle",
          purpose: step.purpose,
          template_key: step.template_key,
          topic: step.topic || "promotions",
          profile_id: profile.id,
          medusa_customer_id: profile.medusa_customer_id,
          flow_id: flow.id,
          flow_key: flow.key,
          flow_enrollment_id: enrollment.id,
          idempotency_key: `sms:${flow.key}:${enrollment.id}:${enrollment.current_step_index}`,
        })
        if (smsResult.deferred) {
          await db("gp_flow_enrollment").where("id", enrollment.id).update({
            next_action_at:
              smsResult.deferUntil || new Date(Date.now() + 60 * 60 * 1000),
            updated_at: now(),
          })
          continue
        }
        if (smsResult.ok && !smsResult.skipped) summary.sent += 1
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          current_step_index: Number(enrollment.current_step_index || 0) + 1,
          next_action_at:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? null
              : now(),
          status:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? "completed"
              : "active",
          completed_at:
            Number(enrollment.current_step_index || 0) + 1 >= steps.length
              ? now()
              : null,
          updated_at: now(),
        })
        continue
      }

      if (step.type !== "email") {
        // Unknown step type (forward-compat): skip it rather than wedge
        // the enrollment forever.
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          current_step_index: Number(enrollment.current_step_index || 0) + 1,
          next_action_at: now(),
          updated_at: now(),
        })
        continue
      }

      const email = buildSimpleMessageEmail({
        subject: step.subject,
        heading: step.heading,
        intro: step.intro,
        paragraphs: step.paragraphs,
        ctaLabel: step.ctaLabel,
        ctaUrl: step.ctaUrl,
      })
      const send = await sendTrackedEmail(container, {
        to: profile.email,
        stream: step.stream || (flow.message_stream as CommunicationStream),
        purpose:
          step.purpose ||
          ((flow.message_purpose ||
            (flow.message_stream === "broadcast"
              ? "broadcast"
              : flow.message_stream === "transactional"
              ? "transactional"
              : "marketing_1to1")) as CommunicationPurpose),
        template_key: step.template_key,
        subject: email.subject,
        html: email.html,
        text: email.text,
        topic: step.topic || "promotions",
        profile_id: profile.id,
        medusa_customer_id: profile.medusa_customer_id,
        flow_id: flow.id,
        flow_key: flow.key,
        flow_enrollment_id: enrollment.id,
        idempotency_key: `${flow.key}:${enrollment.id}:${enrollment.current_step_index}:${profile.email_lower}`,
        template_model: {
          first_name: profile.first_name || "",
          email: profile.email,
        },
      })
      // Defense in depth: if the send-level gate deferred (blackout began
      // between our pre-check and the dispatch), reschedule without
      // advancing — same semantics as the pre-check above.
      if (send.deferred) {
        await db("gp_flow_enrollment").where("id", enrollment.id).update({
          next_action_at: send.deferUntil || nextAllowedSendTime(new Date()),
          updated_at: now(),
        })
        continue
      }

      if (send.ok && !send.skipped) summary.sent += 1
      if (send.ok && step.template_key.startsWith("cart-abandoned")) {
        const trigger = enrollment.trigger_context || {}
        await recordCommunicationEvent(db, {
          event_name: "gp_abandon_email_sent",
          event_id: `gp_abandon_email_sent:${enrollment.id}:${enrollment.current_step_index}`,
          source: "communications",
          profile_id: profile.id,
          email: profile.email,
          cart_id: trigger.cart_id || null,
          flow_id: flow.id,
          template_key: step.template_key,
          properties: {
            flow_key: flow.key,
            enrollment_id: enrollment.id,
          },
        })
      }

      await db("gp_flow_enrollment").where("id", enrollment.id).update({
        current_step_index: Number(enrollment.current_step_index || 0) + 1,
        next_action_at:
          Number(enrollment.current_step_index || 0) + 1 >= steps.length
            ? null
            : now(),
        status:
          Number(enrollment.current_step_index || 0) + 1 >= steps.length
            ? "completed"
            : "active",
        completed_at:
          Number(enrollment.current_step_index || 0) + 1 >= steps.length
            ? now()
            : null,
        updated_at: now(),
      })
    } catch (err) {
      summary.errors += 1
      await recordCommunicationEvent(db, {
        event_name: "flow_step_failed",
        flow_id: enrollment.flow_id,
        profile_id: enrollment.profile_id,
        properties: {
          enrollment_id: enrollment.id,
          error: err instanceof Error ? err.message : String(err),
        },
      })
      await db("gp_flow_enrollment").where("id", enrollment.id).update({
        next_action_at: new Date(Date.now() + 15 * 60 * 1000),
        updated_at: now(),
      })
    }
  }

  return summary
}
