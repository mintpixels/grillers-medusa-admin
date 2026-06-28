import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { fetchOrderForEmail } from "../lib/emails/order-fetch"
import {
  emitTransactionalEmailHandlerFailureAlert,
  emitTransactionalEmailPreconditionAlert,
} from "../lib/emails/ops-alerts"
import { buildOrderShippedEmail } from "../lib/emails/templates/order-shipped"
import { sendTrackedEmail } from "../lib/communications/core"

type ShipmentEventData = {
  id: string
  order_id?: string
  tracking_numbers?: Array<{ tracking_number?: string; url?: string } | string>
  data?: { tracking_url?: string }
  metadata?: Record<string, any>
}

export default async function orderShippedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<ShipmentEventData>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")

  try {
    let orderId = data.order_id

    if (!orderId) {
      const { data: shipments } = await query.graph({
        entity: "fulfillment",
        fields: ["id", "shipped_at", "labels.tracking_number", "labels.tracking_url", "labels.url", "metadata"],
        filters: { id: data.id },
      })
      const shipment = shipments?.[0] as any
      if (!shipment) {
        logger.warn(`[order-shipped-email] no fulfillment found for ${data.id}`)
        void emitTransactionalEmailPreconditionAlert({
          logger,
          templateKey: "order-shipped",
          reason: "fulfillment_not_found",
          path: "src/subscribers/order-shipped-email.ts",
          eventName: "shipment.created",
          eventId: data.id,
          fulfillmentId: data.id,
        })
        return
      }
    }

    if (!orderId) {
      const { data: orderFulfillments } = await query.graph({
        entity: "order_fulfillment",
        fields: ["order_id", "fulfillment_id"],
        filters: { fulfillment_id: data.id },
      })
      orderId = orderFulfillments?.[0]?.order_id
    }

    if (!orderId) {
      logger.warn(`[order-shipped-email] could not resolve order_id for fulfillment ${data.id}`)
      void emitTransactionalEmailPreconditionAlert({
        logger,
        templateKey: "order-shipped",
        reason: "order_id_not_resolved",
        path: "src/subscribers/order-shipped-email.ts",
        eventName: "shipment.created",
        eventId: data.id,
        fulfillmentId: data.id,
      })
      return
    }

    const order = await fetchOrderForEmail(container, orderId)
    if (!order) {
      void emitTransactionalEmailPreconditionAlert({
        logger,
        templateKey: "order-shipped",
        reason: "order_not_found",
        path: "src/subscribers/order-shipped-email.ts",
        eventName: "shipment.created",
        eventId: data.id,
        orderId,
        fulfillmentId: data.id,
      })
      return
    }
    if (!order.email) {
      void emitTransactionalEmailPreconditionAlert({
        logger,
        templateKey: "order-shipped",
        reason: "order_missing_email",
        path: "src/subscribers/order-shipped-email.ts",
        eventName: "shipment.created",
        eventId: data.id,
        orderId: order.id,
        displayId: order.display_id,
        fulfillmentId: data.id,
      })
      return
    }

    const firstTracking = Array.isArray(data.tracking_numbers)
      ? data.tracking_numbers[0]
      : undefined
    const trackingNumber =
      typeof firstTracking === "string"
        ? firstTracking
        : firstTracking?.tracking_number
    const trackingUrl =
      (typeof firstTracking === "object" ? firstTracking?.url : undefined) ||
      data.data?.tracking_url

    const { subject, html, text } = buildOrderShippedEmail({
      order,
      trackingNumber,
      trackingUrl,
      carrier: data.metadata?.carrier as string | undefined,
    })

    logger.info(
      `[order-shipped-email] sending to=${order.email} order=${order.id} tracking=${trackingNumber || "n/a"}`
    )

    await sendTrackedEmail(container, {
      to: order.email,
      stream: "transactional",
      purpose: "transactional",
      template_key: "order-shipped",
      subject,
      html,
      text,
      topic: "order_updates",
      idempotency_key: `order-shipped:${order.id}:${trackingNumber || data.id}`,
      order_id: order.id,
      metadata: {
        order_id: order.id,
        display_id: order.display_id,
        tracking_number: trackingNumber,
      },
    })
  } catch (err) {
    logger.error(
      `[order-shipped-email] failed: ${err instanceof Error ? err.message : String(err)}`
    )
    void emitTransactionalEmailHandlerFailureAlert({
      logger,
      templateKey: "order-shipped",
      path: "src/subscribers/order-shipped-email.ts",
      eventName: "shipment.created",
      eventId: data.id,
      orderId: data.order_id,
      fulfillmentId: data.id,
      error: err,
    })
  }
}

export const config: SubscriberConfig = {
  event: ["shipment.created", "delivery.created"],
}
