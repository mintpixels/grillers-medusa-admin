import { model } from "@medusajs/framework/utils"

const EventDelivery = model
  .define("gp_event_delivery", {
    id: model.id({ prefix: "gpedlv" }).primaryKey(),
    event_id: model.text(),
    event_name: model.text().nullable(),
    target: model.text(),
    status: model.text().default("pending"),
    attempts: model.number().default(0),
    last_attempt_at: model.dateTime().nullable(),
    delivered_at: model.dateTime().nullable(),
    next_attempt_at: model.dateTime().nullable(),
    error_message: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_event_delivery_event",
      on: ["event_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_event_delivery_target_status",
      on: ["target", "status"],
      where: "deleted_at IS NULL",
    },
  ])

export default EventDelivery
