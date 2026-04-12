import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function customerCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")

  try {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: [
        "id",
        "email",
        "first_name",
        "last_name",
        "phone",
        "created_at",
      ],
      filters: { id: data.id },
    })

    const customer = customers?.[0]
    if (!customer) return

    // Track the creation event
    await analyticsService.track({
      event: "customer_created",
      actor_id: customer.id,
      properties: {
        customer_id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        created_at: customer.created_at,
      },
    })

    // Identify the customer for profile syncing
    await analyticsService.identify({
      actor_id: customer.id,
      properties: {
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.phone,
      },
    })
  } catch (err) {
    logger.error(
      `Analytics: Failed to track customer.created for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.created",
}
