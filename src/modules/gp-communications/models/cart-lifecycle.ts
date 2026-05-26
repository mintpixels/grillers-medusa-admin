import { model } from "@medusajs/framework/utils"

const CartLifecycle = model
  .define("gp_cart_lifecycle", {
    id: model.id({ prefix: "gpcartlc" }).primaryKey(),
    cart_id: model.text(),
    profile_id: model.text().nullable(),
    anonymous_id: model.text().nullable(),
    email: model.text().nullable(),
    email_lower: model.text().nullable(),
    customer_type: model.text().default("unknown"),
    route_market: model.text().default("unknown"),
    status: model.text().default("active"),
    first_seen_at: model.dateTime().nullable(),
    last_activity_at: model.dateTime().nullable(),
    checkout_started_at: model.dateTime().nullable(),
    expired_at: model.dateTime().nullable(),
    recovered_at: model.dateTime().nullable(),
    recovered_order_id: model.text().nullable(),
    expire_after_minutes: model.number().default(60),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "UQ_gp_cart_lifecycle_cart",
      on: ["cart_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_cart_lifecycle_status_activity",
      on: ["status", "last_activity_at"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_cart_lifecycle_profile",
      on: ["profile_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default CartLifecycle
