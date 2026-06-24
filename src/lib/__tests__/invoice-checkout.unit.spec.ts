import { isOfflinePaymentApproved } from "../gp-offline-payment"
import {
  orderRequiresFinalCharge,
  fulfillmentGateAllowsShipment,
  isInvoiceOrder,
  finalizationReadyStatus,
  invoiceArOrderMetadata,
  QBD_ACTION_INVOICE_AR,
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

  it("invoice_ar release stamps an A/R posting envelope with NO card fields (#285)", () => {
    const meta = invoiceArOrderMetadata({
      order: {
        id: "order_inv1",
        metadata: { payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR },
      },
      finalization: {
        id: "fin_1",
        final_order_total: 250.5,
        currency_code: "usd",
        estimated_order_total: 240,
        final_item_total: 230,
        final_shipping_total: 15,
        final_tax_total: 5.5,
        final_discount_total: 0,
        delta_total: 10.5,
      },
      actorId: "user_avi",
    }) as Record<string, any>
    // posts to A/R via the writer
    expect(meta.qbd_posting_required).toBe(true)
    expect(meta.qbd_posting_action).toBe(QBD_ACTION_INVOICE_AR)
    expect(meta.qbd_posting_status).toBe("pending_manual")
    // stable, order-keyed request key → idempotent on re-post
    expect(meta.qbd_posting_request_key).toBe("invoice_ar:order_inv1")
    expect(typeof meta.qbd_posting_amount).toBe("number")
    expect(meta.qbd_posting_amount as number).toBeGreaterThan(0)
    // released, invoice workflow, final total
    expect(meta.payment_workflow).toBe(PAYMENT_WORKFLOW_INVOICE_AR)
    expect(meta.finalization_status).toBe(FINALIZATION_RELEASED_TO_FULFILLMENT)
    expect(meta.final_total).toBe(250.5)
    // CRITICAL no-card invariant: no Stripe / charge fields
    expect(meta.stripe_payment_intent_id).toBeUndefined()
    expect(meta.stripe_charge_id).toBeUndefined()
    expect(meta.final_charge_status).toBe("not_applicable_invoice")
  })
})
