import { model } from "@medusajs/framework/utils"

const CommunicationFlow = model
  .define("gp_communication_flow", {
    id: model.id({ prefix: "gpflow" }).primaryKey(),
    key: model.text(),
    name: model.text(),
    description: model.text().nullable(),
    trigger_event: model.text().nullable(),
    trigger_segment_key: model.text().nullable(),
    trigger_conditions: model.json().nullable(),
    steps: model.json(),
    status: model.text().default("draft"),
    message_stream: model.text().default("lifecycle"),
    message_purpose: model.text().default("marketing_1to1"),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_communication_flow_key",
      on: ["key"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_communication_flow_status",
      on: ["status"],
      where: "deleted_at IS NULL",
    },
  ])

export default CommunicationFlow
