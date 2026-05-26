import { model } from "@medusajs/framework/utils"

const SuppressionPreference = model
  .define("gp_suppression_preference", {
    id: model.id({ prefix: "gpsupp" }).primaryKey(),
    email: model.text(),
    email_lower: model.text(),
    profile_id: model.text().nullable(),
    scope: model.text().default("marketing"),
    topic: model.text().nullable(),
    reason: model.text().default("unsubscribe"),
    source: model.text().nullable(),
    unsubscribed_at: model.dateTime().nullable(),
    resubscribed_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_suppression_email_scope",
      on: ["email_lower", "scope"],
      where: "deleted_at IS NULL",
    },
  ])

export default SuppressionPreference
