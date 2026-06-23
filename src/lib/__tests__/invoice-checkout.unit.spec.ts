import { isOfflinePaymentApproved } from "../gp-offline-payment"
import {
  orderRequiresFinalCharge,
  fulfillmentGateAllowsShipment,
  isInvoiceOrder,
  finalizationReadyStatus,
  FINALIZATION_RELEASED_TO_FULFILLMENT,
  FINALIZATION_PACKED_PENDING_CHARGE,
  PAYMENT_WORKFLOW_INVOICE_AR,
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
} from "../catch-weight-finalization"

describe("invoice checkout gating (#283/#284)", () => {
  it("isOfflinePaymentApproved is true only for an explicit boolean true (fail closed)", () => {
    expect(isOfflinePaymentApproved({ gp_offline_payment_approved: true })).toBe(
      true
    )
    expect(
      isOfflinePaymentApproved({ gp_offline_payment_approved: false })
    ).toBe(false)
    // a string "true" must NOT pass — only the real boolean
    expect(
      isOfflinePaymentApproved({ gp_offline_payment_approved: "true" })
    ).toBe(false)
    expect(isOfflinePaymentApproved({})).toBe(false)
    expect(isOfflinePaymentApproved(null)).toBe(false)
    expect(isOfflinePaymentApproved(undefined)).toBe(false)
  })

  it("an invoice order skips the pre-shipment card gate (#284)", () => {
    const invoiceOrder = {
      metadata: { payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR },
    }
    expect(orderRequiresFinalCharge(invoiceOrder)).toBe(false)
    expect(fulfillmentGateAllowsShipment(invoiceOrder)).toBe(true)
  })

  it("a saved-card order still requires the final charge before shipment", () => {
    const cardOrder = {
      metadata: { payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE },
    }
    expect(orderRequiresFinalCharge(cardOrder)).toBe(true)
    expect(fulfillmentGateAllowsShipment(cardOrder)).toBe(false)
  })

  it("a cleanly-packed invoice order releases to fulfillment; a card order waits for charge (#283/#285)", () => {
    const invoice = { metadata: { payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR } }
    const card = {
      metadata: { payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE },
    }
    expect(isInvoiceOrder(invoice)).toBe(true)
    expect(isInvoiceOrder(card)).toBe(false)
    expect(finalizationReadyStatus(invoice)).toBe(
      FINALIZATION_RELEASED_TO_FULFILLMENT
    )
    expect(finalizationReadyStatus(card)).toBe(FINALIZATION_PACKED_PENDING_CHARGE)
  })
})
