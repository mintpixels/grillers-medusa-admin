import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CATCH_WEIGHT_ORDER_FIELDS } from "../lib/catch-weight-finalization"
import {
  FINALIZATION_PACKED_PENDING_CHARGE_EVENT,
  runFinalizationAutoCharge,
} from "../lib/auto-finalize-charge"
import { emitOpsAlert } from "../lib/ops-alert"

/**
 * Gated fixed-price auto-charge (#9/#235).
 *
 * Fires when an order reaches packed_pending_charge (a human confirmed pick/pack).
 * All decision logic lives in ../lib/auto-finalize-charge (unit-tested); this
 * loader-scanned file stays a thin shim — no test file may live under src/subscribers
 * (Medusa imports it at boot and the server crashes on `describe`).
 *
 * Default-OFF: with GRILLERS_AUTO_CHARGE_FIXED_PRICE unset, runFinalizationAutoCharge
 * returns "disabled" before touching the order — behaviour is unchanged (manual charge).
 */

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || "Unknown error")
}

export default async function finalizationAutoChargeHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id?: string; order_id?: string; finalization_id?: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const orderId = data.order_id || data.id

  if (!orderId) return

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const orderModule = container.resolve(Modules.ORDER)
    const eventBus = container.resolve(Modules.EVENT_BUS)

    const { data: orders } = await query.graph({
      entity: "order",
      fields: CATCH_WEIGHT_ORDER_FIELDS,
      filters: { id: orderId },
    })
    const order = orders?.[0] as Record<string, any> | undefined

    if (!order) {
      logger.warn(`[finalization-auto-charge] order not found id=${orderId}`)
      return
    }

    const result = await runFinalizationAutoCharge(
      { db, orderModule, eventBus, logger },
      order
    )

    logger.info(
      `[finalization-auto-charge] order=${orderId} status=${result.status} reason=${result.reason}`
    )
  } catch (err) {
    const message = errorMessage(err)
    logger.error(
      `[finalization-auto-charge] failed for order=${orderId}: ${message}`
    )
    // Fail safe: a thrown auto-charge never charges (the hardened path returns
    // outcomes rather than throwing), so the order simply waits for a manual charge.
    await emitOpsAlert({
      alertKind: "finalization_auto_charge_failed",
      title: "Fixed-price auto-charge trigger failed",
      path: "src/subscribers/finalization-auto-charge.ts",
      source: "medusa-server",
      severity: "warn",
      logger,
      meta: {
        action: "finalization_auto_charge",
        source_event: FINALIZATION_PACKED_PENDING_CHARGE_EVENT,
        order_id: orderId,
        error_message: message.slice(0, 500),
      },
    })
  }
}

export const config: SubscriberConfig = {
  event: FINALIZATION_PACKED_PENDING_CHARGE_EVENT,
}
