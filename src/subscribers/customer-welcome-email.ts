import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { buildWelcomeEmail } from "../lib/emails/templates/welcome"

type CustomerCreatedEvent = {
  id: string
}

export default async function customerWelcomeEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<CustomerCreatedEvent>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const notificationModule = container.resolve(Modules.NOTIFICATION)

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

    logger.info(
      `[customer-welcome-email] sending welcome to=${customer.email} id=${customer.id}`
    )

    await notificationModule.createNotifications({
      to: customer.email,
      channel: "email",
      template: "customer-welcome",
      content: { subject, html, text },
      data: { customer_id: customer.id, email: customer.email },
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
