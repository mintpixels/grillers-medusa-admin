import { emitOpsAlert } from "../ops-alert"
import {
  emitTransactionalEmailHandlerFailureAlert,
  emitTransactionalEmailPreconditionAlert,
} from "../emails/ops-alerts"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("transactional email ops alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits a safe alert when an order email cannot be prepared", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }

    await emitTransactionalEmailPreconditionAlert({
      logger,
      templateKey: "order-placed",
      reason: "order_missing_email",
      path: "src/subscribers/order-placed-email.ts",
      eventName: "order.placed",
      eventId: "order_123",
      orderId: "order_123",
      displayId: 1001,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "transactional_email_precondition_failed",
        severity: "warn",
        title: "order-placed email skipped: order_missing_email",
        path: "src/subscribers/order-placed-email.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          template_key: "order-placed",
          reason: "order_missing_email",
          event_name: "order.placed",
          event_id: "order_123",
          order_id: "order_123",
          display_id: 1001,
          fulfillment_id: null,
          payment_id: null,
          refund_id: null,
        }),
      })
    )
  })

  it("includes fulfillment and refund resolution context without customer email", async () => {
    await emitTransactionalEmailPreconditionAlert({
      templateKey: "refund-issued",
      reason: "order_id_not_resolved",
      path: "src/subscribers/refund-issued-email.ts",
      eventName: "payment.refunded",
      eventId: "pay_123",
      paymentId: "pay_123",
      refundId: "refund_123",
      fulfillmentId: "ful_123",
    })

    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(meta).toEqual(
      expect.objectContaining({
        template_key: "refund-issued",
        reason: "order_id_not_resolved",
        event_name: "payment.refunded",
        event_id: "pay_123",
        fulfillment_id: "ful_123",
        payment_id: "pay_123",
        refund_id: "refund_123",
      })
    )
    expect(JSON.stringify(meta)).not.toContain("@")
  })

  it("emits a redacted handler failure alert for unexpected subscriber errors", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }

    await emitTransactionalEmailHandlerFailureAlert({
      logger,
      templateKey: "order-final-charge",
      path: "src/subscribers/order-final-charge-email.ts",
      eventName: "order.final_charge_succeeded",
      eventId: "evt_final_charge_123",
      orderId: "order_123",
      displayId: 1001,
      error: new Error("Post-render failed for customer@example.com"),
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "transactional_email_handler_failed",
        severity: "warn",
        title: "order-final-charge email handler failed",
        path: "src/subscribers/order-final-charge-email.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          template_key: "order-final-charge",
          event_name: "order.final_charge_succeeded",
          event_id: "evt_final_charge_123",
          order_id: "order_123",
          display_id: 1001,
          customer_id: null,
          fulfillment_id: null,
          payment_id: null,
          refund_id: null,
          error_message: "Post-render failed for [redacted-email]",
        }),
      })
    )
  })
})
