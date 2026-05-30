import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { importOrderToQbSync } from "./qb-sync-order-import"

type PaymentRefundedEvent = {
  id?: string
  payment_id?: string
  refund_id?: string
  order_id?: string | null
}

export default async function qbSyncPaymentRefundedImportHandler({
  event: { data },
  container,
}: SubscriberArgs<PaymentRefundedEvent>) {
  const logger = container.resolve("logger")
  const orderId = data.order_id

  if (!orderId) {
    logger.warn(
      `[qb-sync-payment-refunded-import] missing order_id for refund=${data.refund_id || "unknown"} payment=${data.payment_id || data.id || "unknown"}`
    )
    return
  }

  await importOrderToQbSync({
    orderId,
    container,
    source: "payment.refunded",
  })
}

export const config: SubscriberConfig = {
  event: "payment.refunded",
}
