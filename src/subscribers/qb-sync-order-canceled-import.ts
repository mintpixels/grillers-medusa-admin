import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { importOrderToQbSync } from "./qb-sync-order-import"

export default async function qbSyncOrderCanceledImportHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await importOrderToQbSync({
    orderId: data.id,
    container,
    source: "order.canceled",
  })
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
