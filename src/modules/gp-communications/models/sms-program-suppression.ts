import { model } from "@medusajs/framework/utils"

const SmsProgramSuppression = model
  .define("gp_sms_program_suppression", {
    id: model.id({ prefix: "gpsmssupp" }).primaryKey(),
    phone_e164: model.text(),
    program: model.text(),
    reason: model.text().default("keyword_stop"),
    source: model.text().nullable(),
    suppressed_at: model.dateTime(),
    restored_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_sms_program_suppression_phone_program",
      on: ["phone_e164", "program"],
      where: "deleted_at IS NULL",
    },
    {
      name: "UQ_gp_sms_program_suppression_active",
      on: ["phone_e164", "program"],
      unique: true,
      where: "deleted_at IS NULL AND restored_at IS NULL",
    },
  ])

export default SmsProgramSuppression
