import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "customer_id",
        "total",
        "subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "items.*",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_methods.*",
        "payment_collections.payments.*",
      ],
      filters: { id: data.id },
    })

    const order = orders?.[0] as any
    if (!order) return
    const customerId = order.customer_id || undefined

    const coupon = (order as any).promotions?.[0]?.code

    await analyticsService.track({
      event: "order_completed",
      actor_id: customerId,
      properties: {
        transaction_id: order.id,
        display_id: order.display_id,
        value: order.total,
        subtotal: order.subtotal,
        currency: order.currency_code,
        tax: order.tax_total,
        shipping: order.shipping_total,
        discount: order.discount_total,
        coupon,
        email: order.email,
        customer_id: customerId,
        shipping_tier: order.shipping_methods?.[0]?.name,
        payment_method:
          order.payment_collections?.[0]?.payments?.[0]?.provider_id,
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
        })),
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track order.placed for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
