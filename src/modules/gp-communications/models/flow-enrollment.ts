import { model } from "@medusajs/framework/utils"

const FlowEnrollment = model
  .define("gp_flow_enrollment", {
    id: model.id({ prefix: "gpenroll" }).primaryKey(),
    flow_id: model.text(),
    flow_key: model.text(),
    profile_id: model.text(),
    trigger_event_id: model.text().nullable(),
    trigger_context: model.json().nullable(),
    current_step_index: model.number().default(0),
    status: model.text().default("active"),
    enrolled_at: model.dateTime(),
    next_action_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),
    exited_at: model.dateTime().nullable(),
    exit_reason: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_flow_enrollment_next_action",
      on: ["next_action_at"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_flow_enrollment_profile",
      on: ["profile_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default FlowEnrollment
