import {
  emitChargeFailedHoldAlert,
  emitChargeFailedPostShipAlert,
  emitChargeMarkedReadyButPiNotSucceededAlert,
  emitFinalChargeNonSucceededAlert,
} from "../final-charge-ops-alerts"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("final charge ops alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits an alert for non-succeeded final charge PaymentIntents", async () => {
    await emitFinalChargeNonSucceededAlert({
      orderId: "order_123",
      finalizationId: "fin_123",
      paymentIntentId: "pi_123",
      paymentIntentStatus: "processing",
      amount: 2500,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "final_charge_non_succeeded_payment_intent",
        path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
        severity: "page",
        meta: expect.objectContaining({
          order_id: "order_123",
          finalization_id: "fin_123",
          payment_intent_id: "pi_123",
          payment_intent_status: "processing",
          amount: 2500,
        }),
      })
    )
  })

  it("emits an alert for charge_failed_hold entries", async () => {
    await emitChargeFailedHoldAlert({
      orderId: "order_123",
      finalizationId: "fin_123",
      chargeAttemptId: "attempt_123",
      paymentIntentId: "pi_123",
      paymentIntentStatus: "requires_payment_method",
      failureCode: "card_declined",
      failureMessage: "Card declined",
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "charge_failed_hold",
        path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
        severity: "page",
        meta: expect.objectContaining({
          order_id: "order_123",
          finalization_id: "fin_123",
          charge_attempt_id: "attempt_123",
          payment_intent_id: "pi_123",
          payment_intent_status: "requires_payment_method",
          failure_code: "card_declined",
          failure_message: "Card declined",
        }),
      })
    )
  })

  it("emits a page alert when a charge would mark ready while the PI is not succeeded", async () => {
    await emitChargeMarkedReadyButPiNotSucceededAlert({
      orderId: "order_123",
      finalizationId: "fin_123",
      paymentIntentId: "pi_123",
      paymentIntentStatus: "processing",
      amount: 4200,
      blocked: true,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "charge_marked_ready_but_pi_not_succeeded",
        path: "src/api/admin/grillers/orders/[id]/finalization/charge-and-release/route.ts",
        severity: "page",
        meta: expect.objectContaining({
          order_id: "order_123",
          finalization_id: "fin_123",
          payment_intent_id: "pi_123",
          payment_intent_status: "processing",
          amount: 4200,
          transition_blocked: true,
        }),
      })
    )
  })

  it("emits a page alert when a charge fails after the order is marked ready to ship", async () => {
    await emitChargeFailedPostShipAlert({
      orderId: "order_123",
      finalizationId: "fin_123",
      paymentIntentId: "pi_123",
      paymentIntentStatus: "requires_payment_method",
      failureCode: "card_declined",
      failureMessage: "Your card was declined.",
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "charge_failed_post_ship",
        path: "src/api/webhooks/stripe/payment-failed/route.ts",
        severity: "page",
        meta: expect.objectContaining({
          order_id: "order_123",
          finalization_id: "fin_123",
          payment_intent_id: "pi_123",
          payment_intent_status: "requires_payment_method",
          failure_code: "card_declined",
          failure_message: "Your card was declined.",
        }),
      })
    )
  })
})
