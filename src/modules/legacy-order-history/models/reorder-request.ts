import { model } from "@medusajs/framework/utils"

const LegacyReorderRequest = model
  .define("legacy_reorder_request", {
    id: model.id({ prefix: "lgrreq" }).primaryKey(),
    medusa_customer_id: model.text(),
    email_lower: model.text().nullable(),
    customer_name: model.text().nullable(),
    legacy_history_key: model.text(),
    legacy_item_id: model.text().nullable(),
    sku: model.text().nullable(),
    title: model.text(),
    product_title: model.text().nullable(),
    last_ordered_at: model.dateTime().nullable(),
    last_order_ref: model.text().nullable(),
    times_ordered: model.number().default(0),
    order_count: model.number().default(0),
    total_quantity: model.number().default(0),
    unit_price: model.number().default(0),
    currency_code: model.text().default("usd"),
    request_status: model.text().default("submitted"),
    notification_status: model.text().nullable(),
    notification_error: model.text().nullable(),
    requested_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_legacy_reorder_request_medusa_customer_id",
      on: ["medusa_customer_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_reorder_request_legacy_history_key",
      on: ["legacy_history_key"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_reorder_request_request_status",
      on: ["request_status"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_reorder_request_requested_at",
      on: ["requested_at"],
      where: "deleted_at IS NULL",
    },
  ])

export default LegacyReorderRequest
