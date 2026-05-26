import crypto from "crypto"

type KnexLike = any

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const now = () => new Date()

type TemplateRecord = {
  key: string
  name: string
  stream: "transactional" | "lifecycle" | "broadcast"
  purpose?: "transactional" | "service" | "marketing_1to1" | "broadcast"
  consent_required?: boolean
  subject: string
  variables: string[]
  preview_model?: Record<string, any>
}

function templatePurpose(template: TemplateRecord) {
  if (template.purpose) return template.purpose
  if (template.key.startsWith("cart-abandoned")) return "marketing_1to1"
  if (template.stream === "broadcast") return "broadcast"
  if (template.stream === "lifecycle") return "marketing_1to1"
  return "transactional"
}

function templateConsentRequired(template: TemplateRecord) {
  if (typeof template.consent_required === "boolean") {
    return template.consent_required
  }
  return ["marketing_1to1", "broadcast"].includes(templatePurpose(template))
}

export const COMMUNICATION_TEMPLATE_REGISTRY: TemplateRecord[] = [
  {
    key: "order-placed",
    name: "Order confirmation",
    stream: "transactional",
    subject: "We received your Griller's Pride order",
    variables: ["order", "items", "pickup", "delivery", "totals"],
    preview_model: {
      order_number: "10905",
      customer_name: "Avi",
      items: [{ title: "Ground Beef 75/25 - 10 lb Tube", sku: "10-17-03-1" }],
    },
  },
  {
    key: "order-canceled",
    name: "Order cancellation",
    stream: "transactional",
    subject: "Your Griller's Pride order was canceled",
    variables: ["order", "items", "refund"],
  },
  {
    key: "refund-issued",
    name: "Refund receipt",
    stream: "transactional",
    subject: "Your Griller's Pride refund was issued",
    variables: ["order", "refund", "items"],
  },
  {
    key: "order-shipped",
    name: "Shipped or ready notice",
    stream: "transactional",
    subject: "Your Griller's Pride order update",
    variables: ["order", "tracking", "pickup", "delivery"],
  },
  {
    key: "staff-message",
    name: "Staff customer note",
    stream: "transactional",
    subject: "Update from Griller's Pride",
    variables: ["heading", "body", "cta"],
  },
  {
    key: "preferences-link",
    name: "Preferences link",
    stream: "transactional",
    subject: "Manage your Griller's Pride email preferences",
    variables: ["preferences_url"],
  },
  {
    key: "welcome-1",
    name: "Welcome 1",
    stream: "lifecycle",
    subject: "Welcome to Griller's Pride",
    variables: ["first_name", "cta"],
  },
  {
    key: "welcome-2",
    name: "Welcome 2",
    stream: "lifecycle",
    subject: "The cuts customers come back for",
    variables: ["first_name", "cta"],
  },
  {
    key: "welcome-3",
    name: "Welcome 3",
    stream: "lifecycle",
    subject: "Planning your first Griller's Pride order",
    variables: ["first_name", "cta"],
  },
  {
    key: "cart-abandoned-b2c-1",
    name: "B2C abandoned cart 1",
    stream: "transactional",
    purpose: "marketing_1to1",
    subject: "Your Griller's Pride cart is still here",
    variables: ["cart", "first_name", "cta"],
  },
  {
    key: "cart-abandoned-b2c-2",
    name: "B2C abandoned cart 2",
    stream: "transactional",
    purpose: "marketing_1to1",
    subject: "Need help finishing your order?",
    variables: ["cart", "first_name", "cta"],
  },
  {
    key: "cart-abandoned-b2c-3",
    name: "B2C abandoned cart 3",
    stream: "transactional",
    purpose: "marketing_1to1",
    subject: "Last reminder about your cart",
    variables: ["cart", "first_name", "cta"],
  },
  {
    key: "cart-abandoned-b2b-1",
    name: "B2B abandoned cart",
    stream: "transactional",
    purpose: "marketing_1to1",
    subject: "Your Griller's Pride order is ready to review",
    variables: ["cart", "first_name", "cta"],
  },
  {
    key: "post-purchase-review",
    name: "Post-purchase review",
    stream: "lifecycle",
    subject: "How was your order?",
    variables: ["order", "first_name", "cta"],
  },
  {
    key: "first-basket-expansion",
    name: "First basket expansion",
    stream: "lifecycle",
    subject: "A few easy additions for next time",
    variables: ["first_name", "cta"],
  },
  {
    key: "reorder-reminder",
    name: "Reorder reminder",
    stream: "lifecycle",
    subject: "Time to restock?",
    variables: ["first_name", "cta"],
  },
  {
    key: "loyalty-welcome",
    name: "Second-order loyalty",
    stream: "lifecycle",
    subject: "Thanks for ordering again",
    variables: ["first_name", "cta"],
  },
  {
    key: "winback-1",
    name: "At-risk win-back 1",
    stream: "lifecycle",
    subject: "Still cooking with Griller's Pride?",
    variables: ["first_name", "cta"],
  },
  {
    key: "winback-2",
    name: "At-risk win-back 2",
    stream: "lifecycle",
    subject: "Can we help with your next order?",
    variables: ["first_name", "cta"],
  },
  {
    key: "reactivation-1",
    name: "Dormant reactivation 1",
    stream: "lifecycle",
    subject: "A lot has changed at Griller's Pride",
    variables: ["first_name", "cta"],
  },
  {
    key: "reactivation-2",
    name: "Dormant reactivation 2",
    stream: "lifecycle",
    subject: "Your old favorites are easier to reorder",
    variables: ["first_name", "cta"],
  },
  {
    key: "back-in-stock",
    name: "Back in stock",
    stream: "lifecycle",
    subject: "This item is back in stock",
    variables: ["product", "sku", "cta"],
  },
  {
    key: "holiday-reminder",
    name: "Holiday reminder",
    stream: "lifecycle",
    subject: "Plan your Griller's Pride order",
    variables: ["holiday", "deadline", "cta"],
  },
  {
    key: "shortage-substitution",
    name: "Shortage or substitution",
    stream: "transactional",
    subject: "We need your help with an order item",
    variables: ["order", "item", "alternatives"],
  },
  {
    key: "campaign-simple",
    name: "Marketing campaign",
    stream: "broadcast",
    subject: "Griller's Pride update",
    variables: ["first_name", "body", "cta"],
  },
]

export async function seedEmailTemplates(db: KnexLike) {
  for (const template of COMMUNICATION_TEMPLATE_REGISTRY) {
    const existing = await db("gp_email_template")
      .whereNull("deleted_at")
      .where("key", template.key)
      .first()

    const payload = {
      key: template.key,
      name: template.name,
      subject: template.subject,
      message_stream: template.stream,
      message_purpose: templatePurpose(template),
      consent_required: templateConsentRequired(template),
      variables: template.variables,
      preview_model: template.preview_model || {},
      status: "active",
      metadata: {
        managed_by: "communications-platform",
        customer_safe_catalog_required: true,
      },
      updated_at: now(),
    }

    if (existing) {
      await db("gp_email_template").where("id", existing.id).update(payload)
    } else {
      await db("gp_email_template").insert({
        id: id("gptmpl"),
        ...payload,
        version: 1,
        created_at: now(),
      })
    }
  }

  return { templates: COMMUNICATION_TEMPLATE_REGISTRY.length }
}

export async function listEmailTemplates(db: KnexLike) {
  await seedEmailTemplates(db)
  return db("gp_email_template")
    .whereNull("deleted_at")
    .select(
      "id",
      "key",
      "name",
      "subject",
      "message_stream",
      "message_purpose",
      "consent_required",
      "status",
      "version",
      "variables",
      "preview_model",
      "updated_at"
    )
    .orderBy("message_stream", "asc")
    .orderBy("name", "asc")
}
