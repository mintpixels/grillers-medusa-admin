import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

export default async function customerUpdatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const analyticsService = container.resolve("analytics")

  try {
    const { data: customers } = await query.graph({
      entity: "customer",
      fields: ["id", "email", "first_name", "last_name", "phone"],
      filters: { id: data.id },
    })

    const customer = customers?.[0]
    if (!customer) return

    await analyticsService.track({
      event: "customer_updated",
      actor_id: customer.id,
      properties: {
        customer_id: customer.id,
        email: customer.email,
        first_name: customer.first_name,
        last_name: customer.last_name,
      },
    })

    // Re-identify to keep profile in sync
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
      `Analytics: Failed to track customer.updated for ${data.id}`,
      err
    )
  }
}

export const config: SubscriberConfig = {
  event: "customer.updated",
}
