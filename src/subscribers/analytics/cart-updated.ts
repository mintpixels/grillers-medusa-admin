import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { emitAnalyticsSubscriberFailureAlert } from "../../lib/analytics/subscriber-alerts"
import {
  experimentContextFromItem,
  experimentContextFromItems,
  experimentIdentityFromItems,
} from "../../lib/analytics/experiment-context"

export default async function cartUpdatedHandler({
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
        "items.metadata",
        "items.variant.*",
        "items.variant.product.*",
      ],
      filters: { id: data.id },
    })

    const cart = carts?.[0] as any
    if (!cart) return
    const customerId = cart.customer_id || undefined
    const experimentContext = experimentContextFromItems(cart.items)
    const experimentIdentity = experimentIdentityFromItems(cart.items)

    await analyticsService.track({
      event: "cart_updated",
      actor_id: customerId,
      properties: {
        ...experimentIdentity,
        cart_id: cart.id,
        value: cart.total ?? 0,
        currency: cart.currency_code,
        customer_id: customerId,
        experiment_context: experimentContext,
        item_count: cart.items?.length || 0,
        items: cart.items?.map((item: any) => ({
          item_id: item.variant?.product_id || item.id,
          item_name: item.title,
          variant_id: item.variant_id,
          price: item.unit_price,
          quantity: item.quantity,
          kosher_type: item.variant?.product?.metadata?.kosher_type,
          cut_type: item.variant?.product?.metadata?.cut_type,
          experiment_context: experimentContextFromItem(item),
        })),
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track cart.updated for ${data.id}`,
      err
    )
    void emitAnalyticsSubscriberFailureAlert({
      logger,
      medusaEvent: "cart.updated",
      analyticsEvent: "cart_updated",
      entityId: data.id,
      path: "src/subscribers/analytics/cart-updated.ts",
      error: err,
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: "cart.updated",
}
