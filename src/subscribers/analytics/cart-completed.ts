import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function cartCompletedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")

  try {
    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "customer_id",
        "total",
        "currency_code",
        "items.*",
      ],
      filters: { id: data.id },
    })

    const cart = carts?.[0]
    if (!cart) return

    await analyticsService.track({
      event: "checkout_completed",
      actor_id: cart.customer_id || undefined,
      properties: {
        cart_id: cart.id,
        value: (cart as any).total,
        currency: cart.currency_code,
        customer_id: cart.customer_id,
        items: cart.items?.map((item: any) => ({
          item_id: item.product_id || item.id,
          item_name: item.title,
          price: item.unit_price,
          quantity: item.quantity,
        })),
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track cart.completed for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "cart.completed",
}
