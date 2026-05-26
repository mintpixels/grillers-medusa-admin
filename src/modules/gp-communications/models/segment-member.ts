import { model } from "@medusajs/framework/utils"

const SegmentMember = model
  .define("gp_segment_member", {
    id: model.id({ prefix: "gpsegmem" }).primaryKey(),
    segment_id: model.text(),
    profile_id: model.text(),
    entered_at: model.dateTime(),
    exited_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_segment_member_segment",
      on: ["segment_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_segment_member_profile",
      on: ["profile_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default SegmentMember
