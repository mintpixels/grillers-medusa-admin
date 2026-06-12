import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  experimentContextFromItem,
  experimentContextFromItems,
  experimentIdentityFromItems,
} from "../../lib/analytics/experiment-context"
import {
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  finalChargeSucceeded,
  metadataObject,
} from "../../lib/catch-weight-finalization"

export default async function orderPlacedHandler({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string; amount?: number }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")
  const orderId = data.order_id || data.id

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "cart_id",
        "email",
        "currency_code",
        "customer_id",
        "total",
        "subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "items.*",
        "+items.metadata",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_methods.*",
        "payment_collections.payments.*",
      ],
      filters: { id: orderId },
    })

    const order = orders?.[0] as any
    if (!order) return
    const metadata = metadataObject(order.metadata)

    if (
      name === "order.placed" &&
      !finalChargeSucceeded(metadata)
    ) {
      await analyticsService.track({
        event: "order_received",
        actor_id: order.customer_id || undefined,
        properties: {
          transaction_id: order.id,
          cart_id: order.cart_id,
          display_id: order.display_id,
          estimated_value: order.total,
          currency: order.currency_code,
          email: order.email,
          customer_id: order.customer_id || undefined,
          payment_workflow:
            metadata.payment_workflow || PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
          finalization_id: metadata.finalization_id,
          final_charge_status: metadata.final_charge_status || "not_started",
          source: metadata.source === "staff" ? "staff" : "web",
          customer_type: metadata.customer_type || "unknown",
          route_market: metadata.route_market || "unknown",
          fulfillment_tier: metadata.fulfillment_tier || undefined,
        },
      })
      return
    }

    const customerId = order.customer_id || undefined

    const coupon = (order as any).promotions?.[0]?.code
    const experimentContext = experimentContextFromItems(order.items)
    const experimentIdentity = experimentIdentityFromItems(order.items)

    await analyticsService.track({
      event: "order_completed",
      actor_id: customerId,
      properties: {
        ...experimentIdentity,
        transaction_id: order.id,
        display_id: (order as any).display_id,
        value:
          data.amount ||
          Number(metadata.final_total || metadata.final_order_total) ||
          order.total,
        subtotal: order.subtotal,
        currency: order.currency_code,
        tax: order.tax_total,
        shipping: order.shipping_total,
        discount: order.discount_total,
        coupon,
        email: order.email,
        customer_id: customerId,
        experiment_context: experimentContext,
        shipping_tier: order.shipping_methods?.[0]?.name,
        payment_method:
          order.payment_collections?.[0]?.payments?.[0]?.provider_id,
        source: metadata.source === "staff" ? "staff" : "web",
        customer_type: metadata.customer_type || "unknown",
        route_market: metadata.route_market || "unknown",
        fulfillment_tier:
          metadata.fulfillment_tier || order.shipping_methods?.[0]?.name,
        items: order.items?.map((item: any) => ({
          item_id: item.variant?.product_id || item.id,
          item_name: item.title,
          variant_id: item.variant_id,
          price: item.unit_price,
          quantity: item.quantity,
          kosher_type: item.variant?.product?.metadata?.kosher_type,
          cut_type: item.variant?.product?.metadata?.cut_type,
          holiday_association:
            item.variant?.product?.metadata?.holiday_association,
          is_catch_weight:
            item.variant?.product?.metadata?.is_catch_weight,
          experiment_context: experimentContextFromItem(item),
        })),
      },
    })

    if (name === "order.final_charge_succeeded") {
      await analyticsService.track({
        event: "order_finalized",
        actor_id: customerId,
        properties: {
          transaction_id: order.id,
          display_id: (order as any).display_id,
          estimated_total: order.total,
          final_total:
            data.amount ||
            Number(metadata.final_total || metadata.final_order_total) ||
            order.total,
          catch_weight_delta:
            Number(metadata.final_total || metadata.final_order_total || order.total) -
            Number(metadata.estimated_total || order.total),
          currency: order.currency_code,
          email: order.email,
          customer_id: customerId,
          source: metadata.source === "staff" ? "staff" : "web",
          customer_type: metadata.customer_type || "unknown",
          route_market: metadata.route_market || "unknown",
          fulfillment_tier:
            metadata.fulfillment_tier || order.shipping_methods?.[0]?.name,
          lines: order.items?.map((item: any) => ({
            line_item_id: item.id,
            variant_id: item.variant_id,
            estimated_total: item.total,
            final_total:
              metadata[`final_line_total_${item.id}`] || item.total,
          })),
        },
      })
    }
  } catch (err) {
    logger.error(
      `Analytics: Failed to track ${name} for ${orderId}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: ["order.placed", "order.final_charge_succeeded"],
}
