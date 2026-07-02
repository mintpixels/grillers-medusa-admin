import { syncCartLifecycleFromEvent } from "./cart-lifecycle"

type KnexLike = any

export type CartLikeItem = {
  id?: string | null
  quantity?: number | string | null
}

export type CartLike = {
  id?: string | null
  email?: string | null
  customer_id?: string | null
  currency_code?: string | null
  total?: number | string | null
  item_total?: number | string | null
  items?: CartLikeItem[] | null
  metadata?: Record<string, any> | null
}

export type CustomerGroupLike = {
  id?: string | null
  name?: string | null
  metadata?: Record<string, any> | null
}

export type CustomerLike = {
  id?: string | null
  email?: string | null
  metadata?: Record<string, any> | null
  groups?: CustomerGroupLike[] | null
} | null

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {}
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).trim()
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function cartItemCount(cart: CartLike | null | undefined): number {
  const items = Array.isArray(cart?.items) ? cart!.items! : []
  return items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0)
}

/**
 * Mirror of `customerTypeForAnalytics` in the analytics order-placed subscriber
 * so the cart-recovery flows (which condition on `customer_type` = "dtc" |
 * "institutional") route B2B abandoners to the B2B flow and everyone else to
 * B2C. Defaults to "dtc" — never "unknown" — because an "unknown" lifecycle row
 * matches NO recovery flow and would silently never recover.
 */
export function deriveCartCustomerType(
  cart: CartLike | null | undefined,
  customer?: CustomerLike
): string {
  const groups = Array.isArray(customer?.groups) ? customer!.groups! : []
  const institutionalGroup = groups.some((group) => {
    const groupMetadata = asObject(group?.metadata)
    return (
      textOf(group?.name).toLowerCase().includes("institutional") ||
      textOf(group?.id).toLowerCase().includes("institutional") ||
      textOf(groupMetadata.customer_type).toLowerCase() === "institutional" ||
      groupMetadata.institutional === true
    )
  })
  if (institutionalGroup) return "institutional"

  const cartMetadata = asObject(cart?.metadata)
  const customerMetadata = asObject(customer?.metadata)
  const metaCustomerType = (
    textOf(cartMetadata.customer_type) ||
    textOf(cartMetadata.account_type) ||
    textOf(customerMetadata.customer_type) ||
    textOf(customerMetadata.account_type)
  ).toLowerCase()

  if (metaCustomerType === "institutional") return "institutional"
  return "dtc"
}

export function deriveCartRouteMarket(
  cart: CartLike | null | undefined,
  customer?: CustomerLike
): string {
  const cartMetadata = asObject(cart?.metadata)
  const customerMetadata = asObject(customer?.metadata)
  return (
    textOf(cartMetadata.route_market) ||
    textOf(cartMetadata.fulfillmentMarket) ||
    textOf(customerMetadata.route_market) ||
    "unknown"
  )
}

/**
 * Build the lifecycle event that `syncCartLifecycleFromEvent` consumes. Returns
 * `null` (i.e. "do not track") when the cart has no id or no line items —
 * empty/transient carts are not recoverable and would only flood the recovery
 * pipeline with dead-end `gp_cart_expired` events + flow enrollments.
 *
 * We emit `gp_cart_created` for BOTH cart creation and line changes. That is
 * safe because the service dedupes on `cart_id`: the first sighting inserts the
 * lifecycle row and emits the one canonical `gp_cart_created` communication
 * event (deterministic `event_id = gp_cart_created:<cartId>`), and every
 * subsequent call just advances `last_activity_at` on the existing row.
 */
export function buildCartLifecycleEvent(
  cart: CartLike | null | undefined,
  customer?: CustomerLike,
  occurredAt: Date = new Date()
): Record<string, any> | null {
  const cartId = textOf(cart?.id)
  if (!cartId) return null

  const itemCount = cartItemCount(cart)
  if (itemCount <= 0) return null

  const email = textOf(cart?.email) || textOf(customer?.email) || null

  return {
    event_name: "gp_cart_created",
    cart_id: cartId,
    email,
    customer_type: deriveCartCustomerType(cart, customer),
    route_market: deriveCartRouteMarket(cart, customer),
    occurred_at: occurredAt,
    properties: {
      item_count: itemCount,
      value: numberOrNull(cart?.total ?? cart?.item_total),
      currency_code: textOf(cart?.currency_code) || null,
    },
  }
}

/**
 * Record cart activity into the cart-lifecycle table so a cart can later become
 * eligible for recovery. Idempotent per cart (the service upserts on
 * `cart_id`). Returns the lifecycle row, or `null` when the cart is not
 * trackable (no id / no items).
 */
export async function recordCartLifecycleActivity(
  db: KnexLike,
  cart: CartLike | null | undefined,
  customer?: CustomerLike,
  occurredAt?: Date
): Promise<Record<string, any> | null> {
  const event = buildCartLifecycleEvent(cart, customer, occurredAt)
  if (!event) return null
  return syncCartLifecycleFromEvent(db, event)
}
