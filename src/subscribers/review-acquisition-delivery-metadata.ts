import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  mergeReviewDeliveryMetadata,
  normalizeReviewTimestamp,
  type OrderForReviewAcquisitionMetadata,
} from "../lib/review-acquisition-metadata"

type DeliveryEventData = {
  id: string
}

type Query = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data?: any[] }>
}

type DbConnection = (tableName: string) => any

async function resolveOrderIdForFulfillment(
  query: Query,
  fulfillmentId: string
): Promise<string | undefined> {
  const { data: orderFulfillments } = await query.graph({
    entity: "order_fulfillment",
    fields: ["order_id", "fulfillment_id"],
    filters: { fulfillment_id: fulfillmentId },
  })

  return orderFulfillments?.[0]?.order_id
}

async function fetchOrder(
  query: Query,
  orderId: string
): Promise<OrderForReviewAcquisitionMetadata & { customer_id?: string } | null> {
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "created_at", "customer_id", "metadata"],
    filters: { id: orderId },
  })

  return orders?.[0] || null
}

async function fetchFulfillmentDelivery(
  query: Query,
  fulfillmentId: string
): Promise<{ deliveredAt: string } | null> {
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "delivered_at", "created_at", "updated_at"],
    filters: { id: fulfillmentId },
  })

  const fulfillment = fulfillments?.[0]
  if (!fulfillment) return null

  const deliveredAt =
    normalizeReviewTimestamp(fulfillment.delivered_at) ||
    normalizeReviewTimestamp(fulfillment.updated_at) ||
    normalizeReviewTimestamp(fulfillment.created_at)
  if (!deliveredAt) return null

  return { deliveredAt }
}

async function countCustomerOrdersAtPurchase({
  orderModule,
  db,
  customerId,
  order,
}: {
  orderModule: IOrderModuleService
  db: DbConnection
  customerId?: string
  order: OrderForReviewAcquisitionMetadata
}): Promise<number> {
  if (!customerId || !order.created_at) return 1

  const orderCreatedAtIso = normalizeReviewTimestamp(order.created_at)
  if (!orderCreatedAtIso) return 1

  const orderCreatedAt = new Date(orderCreatedAtIso)

  const [, count] = await orderModule.listAndCountOrders(
    {
      customer_id: customerId,
      created_at: {
        $lte: orderCreatedAtIso,
      },
    },
    {
      select: ["id"],
      take: 1,
    }
  )

  const legacyRows = await db("legacy_order")
    .whereNull("deleted_at")
    .where("medusa_customer_id", customerId)
    .andWhere((builder: any) => {
      builder.whereNull("placed_at").orWhere("placed_at", "<=", orderCreatedAt)
    })
    .count({ count: "*" })
  const legacyCount = Number(legacyRows?.[0]?.count || 0)

  return Math.max(1, count + (Number.isFinite(legacyCount) ? legacyCount : 0))
}

export default async function reviewAcquisitionDeliveryMetadataHandler({
  event: { data },
  container,
}: SubscriberArgs<DeliveryEventData>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query") as Query
  const orderModule = container.resolve(Modules.ORDER) as IOrderModuleService
  const db = container.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as DbConnection

  try {
    const fulfillment = await fetchFulfillmentDelivery(query, data.id)
    if (!fulfillment) {
      logger.warn(
        `[review-acquisition-delivery-metadata] no fulfillment delivery found for ${data.id}`
      )
      return
    }

    const orderId = await resolveOrderIdForFulfillment(query, data.id)
    if (!orderId) {
      logger.warn(
        `[review-acquisition-delivery-metadata] could not resolve order for fulfillment ${data.id}`
      )
      return
    }

    const order = await fetchOrder(query, orderId)
    if (!order) {
      logger.warn(
        `[review-acquisition-delivery-metadata] order ${orderId} not found`
      )
      return
    }

    const orderCount = await countCustomerOrdersAtPurchase({
      orderModule,
      db,
      customerId: order.customer_id,
      order,
    })
    const metadata = mergeReviewDeliveryMetadata({
      order,
      deliveredAt: fulfillment.deliveredAt,
      orderCount,
    })

    if (!metadata) return

    await orderModule.updateOrders(order.id, { metadata })
    logger.info(
      `[review-acquisition-delivery-metadata] recorded delivery metadata for order=${order.id} fulfillment=${data.id}`
    )
  } catch (err) {
    logger.error(
      `[review-acquisition-delivery-metadata] failed for fulfillment ${data.id}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}
