import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { recordCommunicationEvent } from "./core"

type KnexLike = any

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const now = () => new Date()

const CART_ACTIVITY_EVENTS = new Set([
  "gp_cart_created",
  "cart_viewed",
  "product_added_to_cart",
  "checkout_started",
  "shipping_info_submitted",
  "payment_info_submitted",
])

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function expireAfterMinutes(event: Record<string, any>) {
  return asNumber(
    event.properties?.expire_after_minutes ||
      event.context?.expire_after_minutes ||
      process.env.COMMUNICATIONS_CART_EXPIRE_MINUTES,
    60
  )
}

function eventTime(event: Record<string, any>) {
  const value = event.occurred_at || event.received_at || new Date()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function emailLower(event: Record<string, any>) {
  return String(event.email_lower || event.email || "")
    .trim()
    .toLowerCase()
}

export async function syncCartLifecycleFromEvent(
  db: KnexLike,
  event: Record<string, any>
) {
  const eventName = String(event.event_name || "")
  const cartId = event.cart_id || event.properties?.cart_id
  if (!cartId) return null

  const existing = await db("gp_cart_lifecycle")
    .whereNull("deleted_at")
    .where("cart_id", cartId)
    .first()

  const timestamp = eventTime(event)
  const common = {
    profile_id: event.profile_id || existing?.profile_id || null,
    anonymous_id: event.anonymous_id || existing?.anonymous_id || null,
    email: event.email || existing?.email || null,
    email_lower: emailLower(event) || existing?.email_lower || null,
    customer_type: event.customer_type || existing?.customer_type || "unknown",
    route_market: event.route_market || existing?.route_market || "unknown",
    metadata: {
      ...(existing?.metadata || {}),
      last_event_id: event.event_id,
      last_event_name: eventName,
    },
    updated_at: now(),
  }

  if (eventName === "order_completed" || eventName === "order_received") {
    if (!existing) return null
    const patch = {
      ...common,
      status: "recovered",
      recovered_at: timestamp,
      recovered_order_id: event.order_id || event.properties?.order_id || null,
    }
    await db("gp_cart_lifecycle").where("id", existing.id).update(patch)
    return { ...existing, ...patch }
  }

  if (eventName === "gp_cart_expired") {
    if (!existing) return null
    const patch = {
      ...common,
      status: "expired",
      expired_at: timestamp,
    }
    await db("gp_cart_lifecycle").where("id", existing.id).update(patch)
    return { ...existing, ...patch }
  }

  if (!CART_ACTIVITY_EVENTS.has(eventName)) return existing || null

  const patch = {
    ...common,
    status: existing?.status === "recovered" ? "recovered" : "active",
    first_seen_at: existing?.first_seen_at || timestamp,
    last_activity_at: timestamp,
    checkout_started_at:
      eventName === "checkout_started"
        ? timestamp
        : existing?.checkout_started_at || null,
    expire_after_minutes: expireAfterMinutes(event),
  }

  if (existing) {
    await db("gp_cart_lifecycle").where("id", existing.id).update(patch)
    return { ...existing, ...patch }
  }

  const row = {
    id: id("gpcart"),
    cart_id: cartId,
    expired_at: null,
    recovered_at: null,
    recovered_order_id: null,
    created_at: now(),
    ...patch,
  }
  await db("gp_cart_lifecycle").insert(row)

  await recordCommunicationEvent(db, {
    event_name: "gp_cart_created",
    event_id: `gp_cart_created:${cartId}`,
    source: "communications",
    profile_id: row.profile_id,
    anonymous_id: row.anonymous_id,
    cart_id: row.cart_id,
    email: row.email,
    customer_type: row.customer_type,
    route_market: row.route_market,
    occurred_at: row.first_seen_at,
    properties: { from_event_id: event.event_id },
  })

  return row
}

export async function expireInactiveCarts(container: MedusaContainer) {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const limit = Math.min(
    500,
    Math.max(1, Number(process.env.COMMUNICATIONS_CART_EXPIRE_BATCH || 100))
  )
  const rows = await db("gp_cart_lifecycle")
    .whereNull("deleted_at")
    .where("status", "active")
    .whereNotNull("last_activity_at")
    .whereRaw(
      "last_activity_at <= now() - make_interval(mins => expire_after_minutes::int)"
    )
    .orderBy("last_activity_at", "asc")
    .limit(limit)

  let expired = 0
  for (const cart of rows) {
    const completion = await db("gp_communication_event")
      .whereNull("deleted_at")
      .where("event_name", "order_completed")
      .where("cart_id", cart.cart_id)
      .first()
    if (completion) {
      await db("gp_cart_lifecycle").where("id", cart.id).update({
        status: "recovered",
        recovered_at: completion.occurred_at || now(),
        recovered_order_id: completion.order_id || null,
        updated_at: now(),
      })
      continue
    }

    await db("gp_cart_lifecycle").where("id", cart.id).update({
      status: "expired",
      expired_at: now(),
      updated_at: now(),
    })

    await recordCommunicationEvent(db, {
      event_name: "gp_cart_expired",
      event_id: `gp_cart_expired:${cart.cart_id}`,
      source: "communications",
      profile_id: cart.profile_id,
      anonymous_id: cart.anonymous_id,
      cart_id: cart.cart_id,
      email: cart.email,
      customer_type: cart.customer_type,
      route_market: cart.route_market,
      properties: {
        first_seen_at: cart.first_seen_at,
        last_activity_at: cart.last_activity_at,
        checkout_started_at: cart.checkout_started_at,
      },
    })
    expired += 1
  }

  return { scanned: rows.length, expired }
}
