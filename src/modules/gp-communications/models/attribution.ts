import { model } from "@medusajs/framework/utils"

const Attribution = model
  .define("gp_attribution", {
    id: model.id({ prefix: "gpattr" }).primaryKey(),
    profile_id: model.text().nullable(),
    email_lower: model.text().nullable(),
    order_id: model.text(),
    cart_id: model.text().nullable(),
    message_id: model.text().nullable(),
    campaign_id: model.text().nullable(),
    flow_id: model.text().nullable(),
    flow_key: model.text().nullable(),
    template_key: model.text().nullable(),
    source_event_id: model.text().nullable(),
    attribution_type: model.text().default("last_click"),
    attributed_revenue: model.bigNumber().default(0),
    currency_code: model.text().default("usd"),
    occurred_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_gp_attribution_order_type",
      on: ["order_id", "attribution_type"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_attribution_campaign",
      on: ["campaign_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_attribution_flow",
      on: ["flow_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default Attribution
