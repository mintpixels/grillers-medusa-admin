import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { recordCartLifecycleActivity } from "../lib/communications/cart-activity"
import { emitOpsAlert } from "../lib/ops-alert"

const ALERT_PATH = "src/subscribers/communications-cart-lifecycle.ts"

function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 300)
}

/**
 * Bridges Medusa cart activity into the communications cart-lifecycle table so
 * carts can become eligible for the cart-recovery flows (#15). Those flows key
 * on `gp_cart_expired`, which the daily `expireInactiveCarts` job derives from
 * the `gp_cart_created` lifecycle rows this subscriber creates.
 *
 * Server-side capture is authoritative: it catches every cart with items, not
 * just storefront-emitted ones. It stays dormant with no ill effect until
 * REDIS_URL + Postmark are configured (recording lifecycle rows is harmless).
 *
 * Fire-and-forget: any failure is logged + alerted and swallowed. This handler
 * must NEVER throw into the event bus or it could block cart mutation/checkout.
 */
export default async function communicationsCartLifecycle({
  event: { name, data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger")
  const cartId = data?.id
  if (!cartId) return

  try {
    const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const query = container.resolve("query")

    const { data: carts } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "email",
        "customer_id",
        "currency_code",
        "total",
        "metadata",
        "items.id",
        "items.quantity",
      ],
      filters: { id: cartId },
    })

    const cart = carts?.[0] as any
    if (!cart) return

    let customer = null as any
    if (cart.customer_id) {
      const { data: customers } = await query.graph({
        entity: "customer",
        fields: [
          "id",
          "email",
          "metadata",
          "groups.id",
          "groups.name",
          "groups.metadata",
        ],
        filters: { id: cart.customer_id },
      })
      customer = customers?.[0] || null
    }

    await recordCartLifecycleActivity(db, cart, customer)
  } catch (err) {
    logger.warn(
      `[communications] failed to record cart lifecycle for ${cartId}: ${redactedErrorMessage(
        err
      )}`
    )
    void emitOpsAlert({
      alertKind: "communications_cart_lifecycle_record_failed",
      severity: "warn",
      title: `Communications cart lifecycle capture failed for ${cartId}`,
      path: ALERT_PATH,
      source: "medusa-server",
      logger,
      meta: {
        medusa_event_name: name || null,
        cart_id: cartId,
        error: redactedErrorMessage(err),
      },
    }).catch(() => undefined)
  }
}

export const config: SubscriberConfig = {
  event: ["cart.created", "cart.updated"],
}
