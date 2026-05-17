import { model } from "@medusajs/framework/utils"

const LegacyItemMatchRule = model
  .define("legacy_item_match_rule", {
    id: model.id({ prefix: "lgimrule" }).primaryKey(),
    source: model.text().default("quickbooks_desktop"),
    priority: model.number().default(100),
    qbd_item_list_id: model.text().nullable(),
    sku: model.text().nullable(),
    description_contains: model.text().nullable(),
    description_fingerprint: model.text().nullable(),
    medusa_product_id: model.text().nullable(),
    medusa_variant_id: model.text().nullable(),
    medusa_product_title: model.text().nullable(),
    medusa_variant_title: model.text().nullable(),
    confidence: model.number().default(0),
    mapping_source: model.text().nullable(),
    last_seen_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_legacy_item_match_rule_qbd_item_list_id",
      on: ["qbd_item_list_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_item_match_rule_sku",
      on: ["sku"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_item_match_rule_medusa_variant_id",
      on: ["medusa_variant_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_legacy_item_match_rule_priority",
      on: ["priority"],
      where: "deleted_at IS NULL",
    },
  ])

export default LegacyItemMatchRule
