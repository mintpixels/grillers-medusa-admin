import { model } from "@medusajs/framework/utils"

const CustomerPhoneObservation = model
  .define("gp_customer_phone_observation", {
    id: model.id({ prefix: "gpphobs" }).primaryKey(),
    observation_key: model.text(),
    phone_key: model.text(),
    phone_intelligence_id: model.text().nullable(),
    e164: model.text().nullable(),
    normalized_digits: model.text().nullable(),
    valid_us: model.boolean().default(false),
    raw_phone: model.text().nullable(),
    source: model.text(),
    source_record_id: model.text().nullable(),
    phone_field: model.text(),
    medusa_customer_id: model.text().nullable(),
    qbd_customer_list_id: model.text().nullable(),
    legacy_customer_id: model.text().nullable(),
    profile_id: model.text().nullable(),
    customer_email_lower: model.text().nullable(),
    first_name: model.text().nullable(),
    last_name: model.text().nullable(),
    company_name: model.text().nullable(),
    is_primary_customer_phone: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_gp_customer_phone_observation_key",
      on: ["observation_key"],
      unique: true,
    },
    {
      name: "IDX_gp_customer_phone_observation_phone",
      on: ["phone_key"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_phone_observation_medusa_customer",
      on: ["medusa_customer_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_customer_phone_observation_qbd_customer",
      on: ["qbd_customer_list_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default CustomerPhoneObservation
