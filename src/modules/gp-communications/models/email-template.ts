import { model } from "@medusajs/framework/utils"

const EmailTemplate = model
  .define("gp_email_template", {
    id: model.id({ prefix: "gptmpl" }).primaryKey(),
    key: model.text(),
    name: model.text(),
    subject: model.text(),
    preheader: model.text().nullable(),
    html_body: model.text().nullable(),
    text_body: model.text().nullable(),
    postmark_template_alias: model.text().nullable(),
    postmark_template_id: model.text().nullable(),
    message_stream: model.text().default("lifecycle"),
    message_purpose: model.text().default("marketing_1to1"),
    consent_required: model.boolean().default(true),
    variables: model.json().nullable(),
    preview_model: model.json().nullable(),
    status: model.text().default("active"),
    version: model.number().default(1),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_gp_email_template_key",
      on: ["key"],
      where: "deleted_at IS NULL",
    },
  ])

export default EmailTemplate
