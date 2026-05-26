import { model } from "@medusajs/framework/utils"

const InventoryAllocation = model
  .define("gp_inventory_allocation", {
    id: model.id({ prefix: "ialloc" }).primaryKey(),
    order_id: model.text().nullable(),
    line_item_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    customer_email: model.text().nullable(),
    product_id: model.text(),
    variant_id: model.text(),
    inventory_item_id: model.text().nullable(),
    stock_location_id: model.text().nullable(),
    qbd_list_id: model.text().nullable(),
    sku: model.text().nullable(),
    customer_title: model.text().nullable(),
    quantity: model.number().default(0),
    requested_fulfillment_date: model.dateTime().nullable(),
    fulfillment_type: model.text().nullable(),
    source: model.text().default("customer_web"),
    status: model.text().default("reserved"),
    allocation_reason: model.text().nullable(),
    override_reason: model.text().nullable(),
    override_note: model.text().nullable(),
    staff_actor_customer_id: model.text().nullable(),
    staff_actor_email: model.text().nullable(),
    substitution_group_id: model.text().nullable(),
    original_allocation_id: model.text().nullable(),
    released_at: model.dateTime().nullable(),
    fulfilled_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_inventory_allocation_variant_status_date",
      on: ["variant_id", "status", "requested_fulfillment_date"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_allocation_order",
      on: ["order_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_allocation_line",
      on: ["line_item_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_inventory_allocation_qbd_list_id",
      on: ["qbd_list_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default InventoryAllocation
