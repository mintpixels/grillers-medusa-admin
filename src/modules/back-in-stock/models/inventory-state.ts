import { model } from "@medusajs/framework/utils"

const BackInStockInventoryState = model
  .define("back_in_stock_inventory_state", {
    id: model.id({ prefix: "bisst" }).primaryKey(),
    inventory_item_id: model.text(),
    product_id: model.text().nullable(),
    product_handle: model.text().nullable(),
    variant_id: model.text().nullable(),
    sku: model.text().nullable(),
    available_quantity: model.number().default(0),
    was_in_stock: model.boolean().default(false),
    out_of_stock_since: model.dateTime().nullable(),
    last_restocked_at: model.dateTime().nullable(),
    last_seen_at: model.dateTime().nullable(),
    last_notification_started_at: model.dateTime().nullable(),
    last_notification_finished_at: model.dateTime().nullable(),
    last_notification_count: model.number().default(0),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_back_in_stock_inventory_state_item",
      on: ["inventory_item_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_back_in_stock_inventory_state_product",
      on: ["product_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_back_in_stock_inventory_state_variant",
      on: ["variant_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_back_in_stock_inventory_state_sku",
      on: ["sku"],
      where: "deleted_at IS NULL",
    },
  ])

export default BackInStockInventoryState
