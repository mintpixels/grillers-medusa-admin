import { model } from "@medusajs/framework/utils"

const CustomerProfile = model
  .define("gp_customer_profile", {
    id: model.id({ prefix: "gpcprof" }).primaryKey(),
    medusa_customer_id: model.text().nullable(),
    email: model.text().nullable(),
    email_lower: model.text().nullable(),
    phone: model.text().nullable(),
    first_name: model.text().nullable(),
    last_name: model.text().nullable(),
    customer_type: model.text().default("dtc"),
    route_market: model.text().default("unknown"),
    lifecycle_stage: model.text().default("lead"),
    total_orders: model.number().default(0),
    total_revenue: model.bigNumber().default(0),
    avg_order_value: model.bigNumber().default(0),
    first_basket_size: model.number().nullable(),
    first_order_at: model.dateTime().nullable(),
    last_order_at: model.dateTime().nullable(),
    last_active_at: model.dateTime().nullable(),
    preferred_products: model.json().nullable(),
    preferred_categories: model.json().nullable(),
    preferred_cuts: model.json().nullable(),
    preferred_kosher_types: model.json().nullable(),
    preferred_delivery_zone: model.text().nullable(),
    holiday_buyer: model.boolean().default(false),
    email_consent: model.boolean().default(false),
    email_consent_at: model.dateTime().nullable(),
    sms_consent: model.boolean().default(false),
    sms_consent_at: model.dateTime().nullable(),
    preferences: model.json().nullable(),
    preference_token: model.text().nullable(),
    engagement_score: model.number().default(0),
    rfm_recency: model.number().nullable(),
    rfm_frequency: model.number().nullable(),
    rfm_monetary: model.bigNumber().nullable(),
    merged_into_profile_id: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_customer_profile_email_lower",
      on: ["email_lower"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_profile_medusa_customer_id",
      on: ["medusa_customer_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_profile_lifecycle",
      on: ["lifecycle_stage"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_profile_preference_token",
      on: ["preference_token"],
      where: "deleted_at IS NULL",
    },
  ])

export default CustomerProfile
