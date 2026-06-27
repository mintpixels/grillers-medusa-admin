import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { importOrderToQbSync } from "./qb-sync-order-import"
import { emitOpsAlert } from "../lib/ops-alert"

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
    await emitOpsAlert({
      alertKind: "qbd_refund_import_skipped",
      title: "QBD refund import skipped because payment.refunded had no order_id",
      path: "src/subscribers/qb-sync-payment-refunded-import.ts",
      source: "medusa",
      severity: "page",
      logger,
      meta: {
        source_event: "payment.refunded",
        refund_id: data.refund_id || null,
        payment_id: data.payment_id || data.id || null,
      },
    })
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
