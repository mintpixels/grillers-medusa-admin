import { model } from "@medusajs/framework/utils"

const InventoryAvailabilitySnapshot = model
  .define("gp_inventory_availability_snapshot", {
    id: model.id({ prefix: "iatpsnap" }).primaryKey(),
    cart_id: model.text().nullable(),
    order_id: model.text().nullable(),
    product_id: model.text().nullable(),
    variant_id: model.text(),
    qbd_list_id: model.text().nullable(),
    requested_quantity: model.number().default(0),
    requested_fulfillment_date: model.dateTime().nullable(),
    fulfillment_type: model.text().nullable(),
    current_stock_quantity: model.number().default(0),
    allocated_quantity: model.number().default(0),
    safety_stock_quantity: model.number().default(0),
    available_to_promise_quantity: model.number().default(0),
    lifecycle: model.text().default("active"),
    decision: model.text().default("available"),
    reason: model.text().nullable(),
    source: model.text().default("customer_web"),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_inventory_availability_snapshot_variant",
      on: ["variant_id", "created_at"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_availability_snapshot_cart",
      on: ["cart_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_availability_snapshot_order",
      on: ["order_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default InventoryAvailabilitySnapshot
