// Mock the shared hardened charge engine so we can assert WHETHER/HOW OFTEN it is
// invoked, without touching Stripe or the DB. runFinalChargeAndRelease itself is
// covered by the charge-and-release route unit test.
const mockRunFinalChargeAndRelease = jest.fn()
const mockPreviewFinalization = jest.fn()

jest.mock("../final-charge-execution", () => {
  const actual = jest.requireActual("../final-charge-execution")
  return {
    ...actual,
    runFinalChargeAndRelease: (...args: any[]) =>
      mockRunFinalChargeAndRelease(...args),
  }
})

jest.mock("../catch-weight-finalization", () => {
  const actual = jest.requireActual("../catch-weight-finalization")
  return {
    ...actual,
    previewFinalization: (...args: any[]) => mockPreviewFinalization(...args),
  }
})

import {
  AUTO_CHARGE_STAFF_ACTOR_NAME,
  GRILLERS_AUTO_CHARGE_FIXED_PRICE,
  autoChargeFixedPriceEnabled,
  evaluateFixedPriceAutoChargeEligibility,
  runFinalizationAutoCharge,
} from "../auto-finalize-charge"
import { stableFinalChargeIdempotencyKey } from "../final-charge-execution"
import {
  FINALIZATION_CHARGED_READY_TO_SHIP,
  FINALIZATION_CHARGE_FAILED_HOLD,
  FINALIZATION_PACKED_PENDING_CHARGE,
  PAYMENT_WORKFLOW_INVOICE_AR,
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
} from "../catch-weight-finalization"

const ON = { [GRILLERS_AUTO_CHARGE_FIXED_PRICE]: "true" } as NodeJS.ProcessEnv
const OFF = {} as NodeJS.ProcessEnv

const fixedPriceOrder = (overrides: Record<string, any> = {}) => ({
  id: "order_123",
  currency_code: "usd",
  display_id: 42,
  metadata: { payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE },
  ...overrides,
})

const eligiblePreview = (overrides: Record<string, any> = {}) => ({
  finalization: { id: "fin_123", status: FINALIZATION_PACKED_PENDING_CHARGE },
  lines: [{ pricing_mode: "fixed_price" }, { pricing_mode: "fixed_price" }],
  totals: { final_order_total: 5000, delta_total: 0 },
  errors: [],
  ...overrides,
})

const services = () =>
  ({
    db: jest.fn(),
    orderModule: {
      listOrderTransactions: jest.fn(async () => []),
      addOrderTransactions: jest.fn(async () => undefined),
      updateOrders: jest.fn(async () => undefined),
    },
    eventBus: { emit: jest.fn(async () => undefined) },
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }) as any

const eligibilityInput = (overrides: Record<string, any> = {}) => ({
  order: fixedPriceOrder(),
  finalizationStatus: FINALIZATION_PACKED_PENDING_CHARGE,
  lines: [{ pricing_mode: "fixed_price" }],
  totals: { final_order_total: 5000, delta_total: 0 },
  errors: [] as unknown[],
  ...overrides,
})

describe("autoChargeFixedPriceEnabled (default-OFF flag)", () => {
  it("is OFF when the flag is unset", () => {
    expect(autoChargeFixedPriceEnabled({})).toBe(false)
  })
  it('is OFF when the flag is any value other than "true"', () => {
    expect(autoChargeFixedPriceEnabled({ [GRILLERS_AUTO_CHARGE_FIXED_PRICE]: "false" })).toBe(false)
    expect(autoChargeFixedPriceEnabled({ [GRILLERS_AUTO_CHARGE_FIXED_PRICE]: "1" })).toBe(false)
  })
  it('is ON only for exactly "true"', () => {
    expect(autoChargeFixedPriceEnabled({ [GRILLERS_AUTO_CHARGE_FIXED_PRICE]: "true" })).toBe(true)
  })
})

describe("evaluateFixedPriceAutoChargeEligibility (fail-safe guards)", () => {
  it("is eligible for a fixed-price, packed_pending_charge order with final == estimate", () => {
    expect(evaluateFixedPriceAutoChargeEligibility(eligibilityInput())).toEqual({
      eligible: true,
      reason: "eligible",
    })
  })

  it("is NOT eligible when any line is catch-weight (per_lb)", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({
        lines: [{ pricing_mode: "fixed_price" }, { pricing_mode: "per_lb" }],
      })
    )
    expect(result).toEqual({ eligible: false, reason: "catch_weight_line" })
  })

  it("is NOT eligible for an invoice (A/R) order", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({
        order: fixedPriceOrder({
          metadata: { payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR },
        }),
      })
    )
    expect(result).toEqual({ eligible: false, reason: "invoice_ar_order" })
  })

  it("is NOT eligible when the order is not a final-charge (card) order", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ order: fixedPriceOrder({ metadata: {} }) })
    )
    expect(result).toEqual({ eligible: false, reason: "not_final_charge_order" })
  })

  it("is NOT eligible when the order is already charged", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({
        order: fixedPriceOrder({
          metadata: {
            payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
            final_charge_status: "succeeded",
          },
        }),
      })
    )
    expect(result).toEqual({ eligible: false, reason: "already_charged" })
  })

  it("is NOT eligible in charge_failed_hold (never auto-charges a held order)", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ finalizationStatus: FINALIZATION_CHARGE_FAILED_HOLD })
    )
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("status_not_packed_pending_charge")
  })

  it("is NOT eligible when final total != estimate (non-zero delta)", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ totals: { final_order_total: 5100, delta_total: 100 } })
    )
    expect(result).toEqual({ eligible: false, reason: "final_not_equal_estimate" })
  })

  it("is NOT eligible when there are unresolved line errors", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ errors: [{ message: "line error" }] })
    )
    expect(result).toEqual({ eligible: false, reason: "line_errors" })
  })

  it("is NOT eligible when the final total is unavailable", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ totals: { final_order_total: null, delta_total: null } })
    )
    expect(result).toEqual({ eligible: false, reason: "final_total_unavailable" })
  })

  it("is NOT eligible when there are no finalization lines", () => {
    const result = evaluateFixedPriceAutoChargeEligibility(
      eligibilityInput({ lines: [] })
    )
    expect(result).toEqual({ eligible: false, reason: "no_finalization_lines" })
  })
})

describe("runFinalizationAutoCharge", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPreviewFinalization.mockResolvedValue(eligiblePreview())
    mockRunFinalChargeAndRelease.mockResolvedValue({
      result: "charged",
      status: 200,
      body: {},
    })
  })

  // (a) flag OFF → no auto-charge, manual path completely untouched.
  it("does NOTHING when the flag is OFF (no preview, no charge)", async () => {
    const result = await runFinalizationAutoCharge(services(), fixedPriceOrder(), OFF)

    expect(result).toEqual({ status: "disabled", reason: "flag_off" })
    expect(mockPreviewFinalization).not.toHaveBeenCalled()
    expect(mockRunFinalChargeAndRelease).not.toHaveBeenCalled()
  })

  // (b) flag ON + non-catch-weight + final == estimate + packed_pending_charge →
  // charge fires exactly once, through the shared hardened path, tagged as automatic.
  it("charges exactly once through the shared charge path when eligible", async () => {
    const svc = services()
    const order = fixedPriceOrder()

    const result = await runFinalizationAutoCharge(svc, order, ON)

    expect(result.status).toBe("charged")
    expect(mockRunFinalChargeAndRelease).toHaveBeenCalledTimes(1)
    expect(mockRunFinalChargeAndRelease).toHaveBeenCalledWith(
      svc,
      order,
      expect.objectContaining({
        staffActor: null,
        staffAudit: expect.objectContaining({
          staff_actor_name: AUTO_CHARGE_STAFF_ACTOR_NAME,
          auto_charge_source: "fixed_price_auto_finalize",
        }),
      })
    )
    // Eligibility read is non-mutating.
    expect(mockPreviewFinalization).toHaveBeenCalledWith(
      svc.db,
      order,
      { persist: false }
    )
  })

  // (c) flag ON + catch-weight order → NOT auto-charged.
  it("does NOT charge a catch-weight order even with the flag ON", async () => {
    mockPreviewFinalization.mockResolvedValue(
      eligiblePreview({
        lines: [{ pricing_mode: "fixed_price" }, { pricing_mode: "per_lb" }],
      })
    )

    const result = await runFinalizationAutoCharge(services(), fixedPriceOrder(), ON)

    expect(result).toEqual({ status: "skipped", reason: "catch_weight_line" })
    expect(mockRunFinalChargeAndRelease).not.toHaveBeenCalled()
  })

  // (d) idempotency: two fires for the same order do NOT double-charge.
  it("does not double-charge when the trigger fires twice for the same order", async () => {
    const svc = services()

    // First fire: order is packed_pending_charge → eligible → charge fires once.
    const first = await runFinalizationAutoCharge(svc, fixedPriceOrder(), ON)
    expect(first.status).toBe("charged")

    // After the charge, the order is reloaded as charged/released. Both the
    // already-charged metadata guard AND the status guard now reject re-charge.
    mockPreviewFinalization.mockResolvedValue(
      eligiblePreview({
        finalization: { id: "fin_123", status: FINALIZATION_CHARGED_READY_TO_SHIP },
      })
    )
    const chargedOrder = fixedPriceOrder({
      metadata: {
        payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
        final_charge_status: "succeeded",
        finalization_status: FINALIZATION_CHARGED_READY_TO_SHIP,
      },
    })
    const second = await runFinalizationAutoCharge(svc, chargedOrder, ON)

    expect(second.status).toBe("skipped")
    expect(second.reason).toBe("already_charged")
    // The hardened charge path was invoked exactly ONCE across both fires.
    expect(mockRunFinalChargeAndRelease).toHaveBeenCalledTimes(1)
  })

  it("reports charge_failed (leaving the order for manual handling) when the charge path fails", async () => {
    mockRunFinalChargeAndRelease.mockResolvedValue({
      result: "charge_failed",
      status: 402,
      body: { message: "card_declined" },
    })

    const result = await runFinalizationAutoCharge(services(), fixedPriceOrder(), ON)

    expect(result.status).toBe("charge_failed")
    expect(result.reason).toBe("charge_failed")
  })
})

describe("stableFinalChargeIdempotencyKey (double-charge linchpin)", () => {
  it("is stable for the same (order, finalization) so a race dedupes at Stripe", () => {
    const a = stableFinalChargeIdempotencyKey("order_123", "fin_123")
    const b = stableFinalChargeIdempotencyKey("order_123", "fin_123")
    expect(a).toBe(b)
    expect(a).toBe("final-charge:order_123:fin_123")
  })
})
