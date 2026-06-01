import { model } from "@medusajs/framework/utils"

const OrderFinalizationLine = model
  .define("gp_order_finalization_line", {
    id: model.id({ prefix: "gpfinline" }).primaryKey(),
    finalization_id: model.text(),
    order_id: model.text(),
    line_item_id: model.text(),
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),
    sku: model.text().nullable(),
    qbd_list_id: model.text().nullable(),
    title_snapshot: model.text().nullable(),
    customer_title: model.text().nullable(),
    pricing_mode: model.text().default("fixed"),
    unit_price: model.number().nullable(),
    estimated_unit_price: model.number().nullable(),
    estimated_line_total: model.number().nullable(),
    ordered_quantity: model.number().default(0),
    estimated_weight_each: model.number().nullable(),
    estimated_weight_total: model.number().nullable(),
    actual_quantity: model.number().nullable(),
    actual_piece_count: model.number().nullable(),
    actual_weight_each: model.number().nullable(),
    actual_weight_total: model.number().nullable(),
    actual_unit_price: model.number().nullable(),
    final_line_subtotal: model.number().nullable(),
    final_line_total: model.number().nullable(),
    delta_line_total: model.number().nullable(),
    status: model.text().default("needs_weight"),
    replacement_variant_id: model.text().nullable(),
    replacement_qbd_list_id: model.text().nullable(),
    replacement_reason: model.text().nullable(),
    short_reason: model.text().nullable(),
    requires_customer_consent: model.boolean().default(false),
    customer_consent_status: model.text().default("not_required"),
    manager_override_reason: model.text().nullable(),
    exception_reason: model.text().nullable(),
    note: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_order_finalization_line_finalization",
      on: ["finalization_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_order_finalization_line_order",
      on: ["order_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_order_finalization_line_item",
      on: ["line_item_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default OrderFinalizationLine
