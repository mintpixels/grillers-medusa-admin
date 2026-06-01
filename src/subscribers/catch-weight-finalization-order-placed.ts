import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  CATCH_WEIGHT_ORDER_FIELDS,
  ensureFinalizationForOrder,
  orderPlacedFinalizationMetadata,
} from "../lib/catch-weight-finalization"

export default async function catchWeightFinalizationOrderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = container.resolve(Modules.ORDER)
  const orderId = data.order_id || data.id

  if (!orderId) {
    return
  }

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: CATCH_WEIGHT_ORDER_FIELDS,
      filters: { id: orderId },
    })
    const order = orders?.[0] as Record<string, any> | undefined

    if (!order) {
      logger.warn(`[catch-weight-finalization] order not found id=${orderId}`)
      return
    }

    const { finalization, lines } = await ensureFinalizationForOrder(db, order)
    const metadata = orderPlacedFinalizationMetadata(order, finalization)

    await orderModule.updateOrders(order.id, { metadata })

    logger.info(
      `[catch-weight-finalization] order=${order.id} finalization=${finalization.id} lines=${lines.length} status=${finalization.status}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[catch-weight-finalization] failed to initialize order=${orderId}: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
