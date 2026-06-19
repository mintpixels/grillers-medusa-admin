import {
  emitChargeFailedHoldAlert,
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
})
