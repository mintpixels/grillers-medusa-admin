import { model } from "@medusajs/framework/utils"

const MessageLog = model
  .define("gp_message_log", {
    id: model.id({ prefix: "gpmsg" }).primaryKey(),
    idempotency_key: model.text().nullable(),
    profile_id: model.text().nullable(),
    medusa_customer_id: model.text().nullable(),
    email: model.text(),
    email_lower: model.text(),
    channel: model.text().default("email"),
    message_stream: model.text().default("transactional"),
    message_purpose: model.text().default("transactional"),
    topic: model.text().nullable(),
    template_key: model.text().nullable(),
    postmark_template_alias: model.text().nullable(),
    flow_id: model.text().nullable(),
    flow_key: model.text().nullable(),
    flow_enrollment_id: model.text().nullable(),
    campaign_id: model.text().nullable(),
    order_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    subject: model.text().nullable(),
    status: model.text().default("queued"),
    postmark_message_id: model.text().nullable(),
    provider_response: model.json().nullable(),
    template_model: model.json().nullable(),
    experiment_context: model.json().nullable(),
    metadata: model.json().nullable(),
    queued_at: model.dateTime().nullable(),
    sent_at: model.dateTime().nullable(),
    delivered_at: model.dateTime().nullable(),
    opened_at: model.dateTime().nullable(),
    clicked_at: model.dateTime().nullable(),
    bounced_at: model.dateTime().nullable(),
    complained_at: model.dateTime().nullable(),
    unsubscribed_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    error_message: model.text().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_message_log_email",
      on: ["email_lower"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_message_log_postmark",
      on: ["postmark_message_id"],
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_gp_message_log_order",
      on: ["order_id"],
      where: "deleted_at IS NULL",
    },
  ])

export default MessageLog
