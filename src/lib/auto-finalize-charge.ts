import {
  FINALIZATION_PACKED_PENDING_CHARGE,
  finalChargeSucceeded,
  isInvoiceOrder,
  orderRequiresFinalCharge,
  previewFinalization,
} from "./catch-weight-finalization"
import {
  runFinalChargeAndRelease,
  type FinalChargeOutcome,
  type FinalChargeServices,
} from "./final-charge-execution"

/**
 * Gated auto-finalize (#9/#235).
 *
 * Trigger: an order transitions to `packed_pending_charge` — i.e. a human picker/
 * packer has confirmed the order is packed (via approveFinalization) and only the
 * final charge click remains. This does NOT auto-charge at order placement and does
 * NOT skip the pick/pack confirmation.
 *
 * Behind a default-OFF flag. When ON, a fixed-price (no catch-weight, final ==
 * estimate) order is charged automatically through the SAME hardened charge path
 * the manual button uses (runFinalChargeAndRelease) — reusing its stable
 * idempotency key, early PaymentIntent persist, and adopt-not-recharge guards. Any
 * ambiguity fails safe: the order is left at packed_pending_charge for a manual
 * charge.
 */

// Default-OFF env flag (like GRILLERS_SHIPPING_FORECAST_* / GRILLERS_BLOCK_NONSUCCEEDED_CHARGE).
export const GRILLERS_AUTO_CHARGE_FIXED_PRICE = "GRILLERS_AUTO_CHARGE_FIXED_PRICE"

// Event emitted by the approve route when a card order reaches packed_pending_charge.
export const FINALIZATION_PACKED_PENDING_CHARGE_EVENT =
  "order.finalization_packed_pending_charge"

// final == estimate is expected to hold to the cent for fixed-price orders; totals
// are rounded to cents, so anything above half a cent is a real delta → not eligible.
export const AUTO_CHARGE_DELTA_EPSILON = 0.005

export const autoChargeFixedPriceEnabled = (
  env: NodeJS.ProcessEnv = process.env
): boolean => env[GRILLERS_AUTO_CHARGE_FIXED_PRICE] === "true"

// Synthetic actor for the audit trail — makes it explicit a charge was automatic,
// not staff-initiated. Flows into finalChargeOrderMetadata's staff_audit_log entry.
export const AUTO_CHARGE_STAFF_ACTOR_NAME = "system:fixed_price_auto_finalize"

export const buildAutoChargeStaffAudit = (): Record<string, any> => ({
  staff_actor_id: null,
  staff_actor_customer_id: null,
  staff_actor_email: null,
  staff_actor_name: AUTO_CHARGE_STAFF_ACTOR_NAME,
  auto_charge_source: "fixed_price_auto_finalize",
})

export type AutoChargeEligibility = {
  eligible: boolean
  reason: string
}

/**
 * Pure eligibility decision. Every guard fails safe (returns not-eligible) so an
 * ambiguous order is never auto-charged. Excludes: invoice_ar (B2B), non-final-charge
 * orders, already-charged orders, any finalization status other than exactly
 * packed_pending_charge (so charge_failed_hold / succeeded_recording_failed / attempting
 * are never auto-charged), orders with line errors, catch-weight lines (any per_lb line),
 * and orders whose final total does not equal the estimate.
 */
export const evaluateFixedPriceAutoChargeEligibility = (input: {
  order: Record<string, any>
  finalizationStatus: string | null | undefined
  lines: Array<Record<string, any>>
  totals: { final_order_total?: number | null; delta_total?: number | null }
  errors: Array<unknown>
}): AutoChargeEligibility => {
  const { order, finalizationStatus, lines, totals, errors } = input

  if (isInvoiceOrder(order)) {
    return { eligible: false, reason: "invoice_ar_order" }
  }

  if (!orderRequiresFinalCharge(order)) {
    return { eligible: false, reason: "not_final_charge_order" }
  }

  if (finalChargeSucceeded(order)) {
    return { eligible: false, reason: "already_charged" }
  }

  if (finalizationStatus !== FINALIZATION_PACKED_PENDING_CHARGE) {
    return {
      eligible: false,
      reason: `status_not_packed_pending_charge:${finalizationStatus ?? "unknown"}`,
    }
  }

  if (Array.isArray(errors) && errors.length > 0) {
    return { eligible: false, reason: "line_errors" }
  }

  if (!Array.isArray(lines) || lines.length === 0) {
    return { eligible: false, reason: "no_finalization_lines" }
  }

  if (lines.some((line) => String(line?.pricing_mode) === "per_lb")) {
    return { eligible: false, reason: "catch_weight_line" }
  }

  const finalTotal = totals?.final_order_total
  if (
    finalTotal === null ||
    finalTotal === undefined ||
    !Number.isFinite(Number(finalTotal))
  ) {
    return { eligible: false, reason: "final_total_unavailable" }
  }

  const delta = totals?.delta_total
  if (
    delta === null ||
    delta === undefined ||
    !Number.isFinite(Number(delta)) ||
    Math.abs(Number(delta)) > AUTO_CHARGE_DELTA_EPSILON
  ) {
    return { eligible: false, reason: "final_not_equal_estimate" }
  }

  return { eligible: true, reason: "eligible" }
}

export type AutoChargeRunResult = {
  status: "disabled" | "skipped" | "charged" | "charge_failed"
  reason: string
  outcome?: FinalChargeOutcome
}

/**
 * Orchestration invoked by the subscriber. Flag-gates, reads the finalization
 * (persist:false — a pure eligibility read, never releases), decides eligibility,
 * and only for an eligible fixed-price order routes through runFinalChargeAndRelease.
 * The charge itself carries the stable idempotency key, so a duplicate event or a
 * concurrent manual charge cannot double-charge.
 */
export async function runFinalizationAutoCharge(
  services: FinalChargeServices,
  order: Record<string, any>,
  env: NodeJS.ProcessEnv = process.env
): Promise<AutoChargeRunResult> {
  if (!autoChargeFixedPriceEnabled(env)) {
    return { status: "disabled", reason: "flag_off" }
  }

  // persist:false — read-only eligibility snapshot (lines, totals, current status).
  const preview = await previewFinalization(services.db, order, {
    persist: false,
  })

  const eligibility = evaluateFixedPriceAutoChargeEligibility({
    order,
    finalizationStatus: preview.finalization?.status,
    lines: preview.lines || [],
    totals: preview.totals || { final_order_total: null, delta_total: null },
    errors: preview.errors || [],
  })

  if (!eligibility.eligible) {
    return { status: "skipped", reason: eligibility.reason }
  }

  const outcome = await runFinalChargeAndRelease(services, order, {
    staffAudit: buildAutoChargeStaffAudit(),
    staffActor: null,
  })

  if (outcome.result === "charged") {
    return { status: "charged", reason: "charged", outcome }
  }

  // charge_failed / charge_recording_failed → engine already recorded the attempt,
  // set the hold status, and paged ops. Everything else (already_charged from a race,
  // preflight_* revalidation) is a benign no-op left for manual handling.
  if (
    outcome.result === "charge_failed" ||
    outcome.result === "charge_recording_failed"
  ) {
    return { status: "charge_failed", reason: outcome.result, outcome }
  }

  return { status: "skipped", reason: outcome.result, outcome }
}
