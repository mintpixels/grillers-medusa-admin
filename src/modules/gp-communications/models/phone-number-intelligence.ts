import { model } from "@medusajs/framework/utils"

const PhoneNumberIntelligence = model
  .define("gp_phone_number_intelligence", {
    id: model.id({ prefix: "gpphone" }).primaryKey(),
    phone_key: model.text(),
    e164: model.text().nullable(),
    normalized_digits: model.text().nullable(),
    valid_us: model.boolean().default(false),
    validation_error: model.text().nullable(),
    twilio_lookup_status: model.text().default("not_requested"),
    twilio_lookup_fields: model.text().nullable(),
    twilio_lookup_performed_at: model.dateTime().nullable(),
    twilio_error_code: model.text().nullable(),
    twilio_error_message: model.text().nullable(),
    line_type: model.text().nullable(),
    carrier_name: model.text().nullable(),
    mobile_country_code: model.text().nullable(),
    mobile_network_code: model.text().nullable(),
    country_code: model.text().nullable(),
    national_format: model.text().nullable(),
    is_probable_mobile: model.boolean().default(false),
    sms_capable_candidate: model.boolean().default(false),
    sms_capability_basis: model.text().default("unknown"),
    source_observation_count: model.number().default(0),
    customer_observation_count: model.number().default(0),
    first_observed_at: model.dateTime().nullable(),
    last_observed_at: model.dateTime().nullable(),
    provider_response: model.json().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_gp_phone_number_intelligence_key",
      on: ["phone_key"],
      unique: true,
    },
    {
      name: "IDX_gp_phone_number_intelligence_e164",
      on: ["e164"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_phone_number_intelligence_line_type",
      on: ["line_type"],
      where: "deleted_at IS NULL",
    },
  ])

export default PhoneNumberIntelligence
