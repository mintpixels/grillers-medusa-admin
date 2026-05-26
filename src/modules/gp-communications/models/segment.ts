import { model } from "@medusajs/framework/utils"

const Segment = model
  .define("gp_segment", {
    id: model.id({ prefix: "gpseg" }).primaryKey(),
    key: model.text(),
    name: model.text(),
    description: model.text().nullable(),
    query_definition: model.json().nullable(),
    status: model.text().default("active"),
    cached_count: model.number().default(0),
    last_computed_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_segment_key",
      on: ["key"],
      where: "deleted_at IS NULL",
    },
  ])

export default Segment
