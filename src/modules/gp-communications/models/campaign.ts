import { model } from "@medusajs/framework/utils"

const Campaign = model
  .define("gp_campaign", {
    id: model.id({ prefix: "gpcamp" }).primaryKey(),
    key: model.text().nullable(),
    name: model.text(),
    description: model.text().nullable(),
    segment_id: model.text().nullable(),
    segment_key: model.text().nullable(),
    template_key: model.text().nullable(),
    subject: model.text().nullable(),
    status: model.text().default("draft"),
    scheduled_at: model.dateTime().nullable(),
    sent_at: model.dateTime().nullable(),
    approved_by: model.text().nullable(),
    approved_at: model.dateTime().nullable(),
    audience_snapshot: model.json().nullable(),
    metrics: model.json().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_campaign_status",
      on: ["status"],
      where: "deleted_at IS NULL",
    },
  ])

export default Campaign
