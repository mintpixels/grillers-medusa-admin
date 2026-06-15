import { model } from "@medusajs/framework/utils"

const CustomerPhoneRecommendation = model
  .define("gp_customer_phone_recommendation", {
    id: model.id({ prefix: "gpphrec" }).primaryKey(),
    customer_key: model.text(),
    medusa_customer_id: model.text().nullable(),
    qbd_customer_list_id: model.text().nullable(),
    legacy_customer_id: model.text().nullable(),
    profile_id: model.text().nullable(),
    customer_email_lower: model.text().nullable(),
    phone_key: model.text().nullable(),
    e164: model.text().nullable(),
    line_type: model.text().nullable(),
    sms_capable_candidate: model.boolean().default(false),
    recommendation_basis: model.text().default("unknown"),
    candidate_count: model.number().default(0),
    mobile_candidate_count: model.number().default(0),
    review_candidate_count: model.number().default(0),
    evaluated_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_gp_customer_phone_recommendation_key",
      on: ["customer_key"],
      unique: true,
    },
    {
      name: "IDX_gp_customer_phone_recommendation_medusa_customer",
      on: ["medusa_customer_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_phone_recommendation_phone",
      on: ["phone_key"],
      where: "deleted_at IS NULL",
    },
  ])

export default CustomerPhoneRecommendation
