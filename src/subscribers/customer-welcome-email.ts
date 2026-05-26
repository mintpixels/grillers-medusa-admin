import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { buildWelcomeEmail } from "../lib/emails/templates/welcome"
import { sendTrackedEmail, upsertCustomerProfile } from "../lib/communications/core"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type CustomerCreatedEvent = {
  id: string
}

export default async function customerWelcomeEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<CustomerCreatedEvent>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "has_account"],
      filters: { id: data.id },
    })
    const customer = customers?.[0]
    if (!customer || !customer.email) return

    if (!customer.has_account) {
      logger.info(
        `[customer-welcome-email] skipping guest customer ${customer.id}`
      )
      return
    }

    const { subject, html, text } = buildWelcomeEmail({
      email: customer.email,
      firstName: customer.first_name,
    })
    const profile = await upsertCustomerProfile(db, {
      medusa_customer_id: customer.id,
      email: customer.email,
      first_name: customer.first_name,
    })

    logger.info(
      `[customer-welcome-email] sending welcome to=${customer.email} id=${customer.id}`
    )

    await sendTrackedEmail(container, {
      to: customer.email,
      stream: "transactional",
      purpose: "service",
      template_key: "customer-welcome",
      subject,
      html,
      text,
      topic: "account",
      idempotency_key: `customer-welcome:${customer.id}`,
      profile_id: profile?.id,
      medusa_customer_id: customer.id,
      metadata: { customer_id: customer.id, email: customer.email },
    })
  } catch (err) {
    logger.error(
      `[customer-welcome-email] failed for customer ${data.id}: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
