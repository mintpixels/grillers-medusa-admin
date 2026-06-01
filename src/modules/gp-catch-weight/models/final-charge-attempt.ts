import { model } from "@medusajs/framework/utils"

const FinalChargeAttempt = model
  .define("gp_final_charge_attempt", {
    id: model.id({ prefix: "gpcharge" }).primaryKey(),
    order_id: model.text(),
    finalization_id: model.text(),
    attempt_number: model.number().default(1),
    amount: model.number(),
    currency_code: model.text().default("usd"),
    stripe_customer_id: model.text().nullable(),
    stripe_payment_method_id: model.text(),
    stripe_payment_intent_id: model.text().nullable(),
    stripe_charge_id: model.text().nullable(),
    status: model.text().default("pending"),
    stripe_status: model.text().nullable(),
    failure_code: model.text().nullable(),
    failure_message: model.text().nullable(),
    idempotency_key: model.text().nullable(),
    requested_by: model.text().nullable(),
    requested_at: model.dateTime().nullable(),
    succeeded_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_final_charge_attempt_order",
      on: ["order_id", "created_at"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_final_charge_attempt_finalization",
      on: ["finalization_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_final_charge_attempt_payment_intent",
      on: ["stripe_payment_intent_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default FinalChargeAttempt
