import { model } from "@medusajs/framework/utils"

const OrderPaymentSetup = model
  .define("gp_order_payment_setup", {
    id: model.id({ prefix: "gpsetup" }).primaryKey(),
    order_id: model.text(),
    cart_id: model.text().nullable(),
    customer_id: model.text().nullable(),
    customer_email: model.text().nullable(),
    stripe_customer_id: model.text().nullable(),
    stripe_payment_method_id: model.text(),
    setup_intent_id: model.text().nullable(),
    account_holder_id: model.text().nullable(),
    status: model.text().default("saved"),
    consent_version: model.text().nullable(),
    consent_text: model.text().nullable(),
    consented_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_order_payment_setup_order",
      on: ["order_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_order_payment_setup_customer",
      on: ["customer_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_order_payment_setup_payment_method",
      on: ["stripe_payment_method_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default OrderPaymentSetup
