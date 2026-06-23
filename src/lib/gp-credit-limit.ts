/**
 * #279 / #286 — credit-limit evaluation for approved B2B invoice accounts.
 *
 * Pure, framework-free math: given an account's credit limit, its current outstanding A/R
 * balance (sum of open, unpaid invoice orders), and a new order total, decide whether the new
 * order stays within the limit or needs a second approval (an over-limit hold). The caller is
 * responsible for sourcing the outstanding balance and for acting on the verdict (placing a
 * hold, etc.). Fail safe: if the limit is missing or non-positive, the order requires review
 * rather than silently extending unlimited credit.
 */

function toNonNegativeNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0
  const n =
    typeof value === "string"
      ? Number(String(value).replace(/[$,]/g, ""))
      : (value as number)
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0
}

function toLimit(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n =
    typeof value === "string"
      ? Number(String(value).replace(/[$,]/g, ""))
      : (value as number)
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : null
}

export type CreditEvaluation = {
  /** The account's credit limit, or null if none is set. */
  creditLimit: number | null
  /** Current open A/R balance (sum of unpaid invoice orders). */
  outstanding: number
  /** The new order's total. */
  orderTotal: number
  /** outstanding + orderTotal. */
  projectedExposure: number
  /** True when the new order keeps the account at or under its limit. */
  withinLimit: boolean
  /** Amount the projected exposure exceeds the limit by (0 when within). */
  overBy: number
  /** True when the order should be held for a second approval (over limit or no limit set). */
  requiresSecondApproval: boolean
}

export function evaluateCreditLimit(input: {
  creditLimit: unknown
  outstanding: unknown
  orderTotal: unknown
}): CreditEvaluation {
  const creditLimit = toLimit(input.creditLimit)
  const outstanding = toNonNegativeNumber(input.outstanding)
  const orderTotal = toNonNegativeNumber(input.orderTotal)
  const projectedExposure = outstanding + orderTotal

  // No usable limit → cannot verify the account is good for it → hold for review.
  if (creditLimit === null) {
    return {
      creditLimit: null,
      outstanding,
      orderTotal,
      projectedExposure,
      withinLimit: false,
      overBy: projectedExposure,
      requiresSecondApproval: true,
    }
  }

  const overBy = Math.max(0, projectedExposure - creditLimit)
  const withinLimit = overBy === 0
  return {
    creditLimit,
    outstanding,
    orderTotal,
    projectedExposure,
    withinLimit,
    overBy,
    requiresSecondApproval: !withinLimit,
  }
}

/** Metadata an over-limit invoice order carries so an approver can review + release it (#286). */
export function creditHoldMetadata(evaluation: CreditEvaluation, placedAt: string) {
  return {
    gp_credit_hold: {
      held: true,
      reason: "credit_limit_exceeded",
      credit_limit: evaluation.creditLimit,
      outstanding: evaluation.outstanding,
      order_total: evaluation.orderTotal,
      projected_exposure: evaluation.projectedExposure,
      over_by: evaluation.overBy,
      placed_at: placedAt,
    },
  }
}
