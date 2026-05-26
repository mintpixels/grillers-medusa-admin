import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  upsertCustomerProfile,
} from "../lib/communications/core"

type EventData = {
  id: string
  order_id?: string
  customer_id?: string
  email?: string
  amount?: number | string
  reason?: string
}

async function fetchOrderContext(container: any, orderId?: string) {
  if (!orderId) return null
  const query = container.resolve("query")
  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "customer_id",
      "currency_code",
      "total",
      "metadata",
      "items.id",
      "items.title",
      "items.quantity",
      "shipping_address.postal_code",
    ],
    filters: { id: orderId },
  })
  return orders?.[0] || null
}

async function updateProfileStatsFromOrder(
  db: any,
  profile: Record<string, any> | null,
  order: Record<string, any> | null
) {
  if (!profile || !order?.id) return

  const alreadyCounted = await db("gp_communication_event")
    .whereNull("deleted_at")
    .where("event_name", "order_completed")
    .where("order_id", order.id)
    .first()

  if (alreadyCounted) return

  const totalOrders = Number(profile.total_orders || 0) + 1
  const totalRevenue = Number(profile.total_revenue || 0) + Number(order.total || 0)
  const firstOrderAt = profile.first_order_at || new Date()
  const firstBasketSize =
    profile.first_basket_size ||
    (Array.isArray(order.items) ? order.items.length : null)

  await db("gp_customer_profile").where("id", profile.id).update({
    total_orders: totalOrders,
    total_revenue: totalRevenue,
    avg_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    first_order_at: firstOrderAt,
    last_order_at: new Date(),
    last_active_at: new Date(),
    first_basket_size: firstBasketSize,
    updated_at: new Date(),
  })
}

export default async function communicationsCommerceEvents({
  event: { name, data },
  container,
}: SubscriberArgs<EventData>) {
  const logger = container.resolve("logger")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const eventName = String(name || "").replace(/\./g, "_")
    let order = null as any
    let customer = null as any
    let email = data.email
    let medusaCustomerId = data.customer_id
    let orderId = data.order_id

    if (name === "order.placed" || name === "order.canceled") {
      orderId = data.id
    }

    if (orderId) {
      order = await fetchOrderContext(container, orderId)
      email = email || order?.email
      medusaCustomerId = medusaCustomerId || order?.customer_id
    }

    if (medusaCustomerId || email) {
      customer = await upsertCustomerProfile(db, {
        medusa_customer_id: medusaCustomerId,
        email,
        customer_type:
          order?.metadata?.customer_type ||
          order?.metadata?.account_type ||
          undefined,
        route_market:
          order?.metadata?.route_market ||
          order?.metadata?.fulfillmentMarket ||
          undefined,
      })
    }

    if (name === "order.placed") {
      await updateProfileStatsFromOrder(db, customer, order)
      if (customer?.id) {
        customer = await db("gp_customer_profile")
          .whereNull("deleted_at")
          .where("id", customer.id)
          .first()
      }
    }

    await recordCommunicationEvent(db, {
      event_name:
        name === "order.placed"
          ? "order_completed"
          : name === "payment.refunded"
            ? "order_refunded"
            : eventName,
      event_id: `${name}:${data.id}:${data.order_id || ""}:${data.amount || ""}`,
      source: "medusa-server",
      profile_id: customer?.id || null,
      medusa_customer_id: medusaCustomerId || null,
      email: email || null,
      order_id: orderId || null,
      customer_type: customer?.customer_type || "unknown",
      route_market: customer?.route_market || "unknown",
      properties: {
        ...data,
        display_id: order?.display_id,
        total: order?.total,
        item_count: Array.isArray(order?.items) ? order.items.length : undefined,
        currency_code: order?.currency_code,
      },
    })
  } catch (err) {
    logger.warn(
      `[communications] failed to record commerce event ${name}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: [
    "order.placed",
    "order.canceled",
    "order.fulfilled",
    "shipment.created",
    "delivery.created",
    "payment.refunded",
    "customer.created",
    "customer.updated",
  ],
}
