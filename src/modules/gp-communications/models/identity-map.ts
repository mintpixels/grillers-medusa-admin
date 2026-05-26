import { model } from "@medusajs/framework/utils"

const IdentityMap = model
  .define("gp_identity_map", {
    id: model.id({ prefix: "gpidmap" }).primaryKey(),
    profile_id: model.text(),
    anonymous_id: model.text().nullable(),
    session_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    medusa_customer_id: model.text().nullable(),
    email_lower: model.text().nullable(),
    first_seen_at: model.dateTime().nullable(),
    last_seen_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_identity_map_profile",
      on: ["profile_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_identity_map_anonymous",
      on: ["anonymous_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_identity_map_cart",
      on: ["cart_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default IdentityMap
