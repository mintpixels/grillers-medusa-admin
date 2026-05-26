import { model } from "@medusajs/framework/utils"

const CommunicationEvent = model
  .define("gp_communication_event", {
    id: model.id({ prefix: "gpcevt" }).primaryKey(),
    event_id: model.text(),
    event_name: model.text(),
    source: model.text().default("medusa-server"),
    profile_id: model.text().nullable(),
    medusa_customer_id: model.text().nullable(),
    anonymous_id: model.text().nullable(),
    session_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    order_id: model.text().nullable(),
    email: model.text().nullable(),
    email_lower: model.text().nullable(),
    customer_type: model.text().default("unknown"),
    route_market: model.text().default("unknown"),
    campaign_id: model.text().nullable(),
    flow_id: model.text().nullable(),
    template_key: model.text().nullable(),
    message_id: model.text().nullable(),
    occurred_at: model.dateTime(),
    received_at: model.dateTime(),
    properties: model.json().nullable(),
    context: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_communication_event_event_id",
      on: ["event_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_communication_event_profile_time",
      on: ["profile_id", "occurred_at"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_communication_event_name_time",
      on: ["event_name", "occurred_at"],
      where: "deleted_at IS NULL",
    },
  ])

export default CommunicationEvent
