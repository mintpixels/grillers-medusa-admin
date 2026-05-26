import { model } from "@medusajs/framework/utils"

const LinkClick = model
  .define("gp_link_click", {
    id: model.id({ prefix: "gpclk" }).primaryKey(),
    message_log_id: model.text().nullable(),
    postmark_message_id: model.text().nullable(),
    profile_id: model.text().nullable(),
    email_lower: model.text().nullable(),
    campaign_id: model.text().nullable(),
    flow_id: model.text().nullable(),
    template_key: model.text().nullable(),
    url: model.text(),
    clicked_at: model.dateTime(),
    user_agent: model.text().nullable(),
    ip: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_link_click_message",
      on: ["message_log_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default LinkClick
