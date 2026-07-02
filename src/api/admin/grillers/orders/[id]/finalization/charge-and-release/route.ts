import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { runFinalChargeAndRelease } from "../../../../../../../lib/final-charge-execution"
import {
  emitFinalizationRouteFailureAlert,
  jsonError,
  loadFinalizationOrderForRoute,
  staffAuditActorId,
  staffAuditFields,
} from "../utils"

type ChargeBody = {
  idempotency_key?: string
  staff_actor_customer_id?: string
  staff_actor_email?: string
  staff_actor_name?: string
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const order = await loadFinalizationOrderForRoute(req, res, {
    action: "charge_and_release_load_order",
    path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
  })
  if (!order) return

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body || {}) as ChargeBody
  const staffAudit = staffAuditFields(req, body)
  const staffActor = staffAuditActorId(staffAudit)

  const outcome = await runFinalChargeAndRelease(
    { db, orderModule, eventBus, logger },
    order,
    { staffAudit, staffActor }
  )

  // A preflight EXCEPTION (e.g. previewFinalization threw) must page route-failure
  // telemetry — the engine surfaces it so this req-scoped alert stays here.
  if (outcome.result === "preflight_exception") {
    await emitFinalizationRouteFailureAlert({
      req,
      action: "charge_and_release_preflight",
      error: outcome.preflightError,
      order,
      orderId: req.params.id,
      path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
      status: 409,
    })
    return jsonError(res, outcome.status, (outcome.body as any).message)
  }

  return res.status(outcome.status).json(outcome.body)
}
