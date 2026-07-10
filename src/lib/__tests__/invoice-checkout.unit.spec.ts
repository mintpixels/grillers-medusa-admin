import { isOfflinePaymentApproved } from "../gp-offline-payment"
import {
  orderRequiresFinalCharge,
  fulfillmentGateAllowsShipment,
  isInvoiceOrder,
  finalizationReadyStatus,
  finalizedCatchWeightOrderMetadata,
  invoiceArOrderMetadata,
  QBD_ACTION_INVOICE_AR,
  FINALIZATION_RELEASED_TO_FULFILLMENT,
  FINALIZATION_PACKED_PENDING_CHARGE,
  PAYMENT_WORKFLOW_INVOICE_AR,
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  withoutCardPaymentMetadata,
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
        metadata: {
          payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR,
          stripe_provider_id: "pp_stripe_stripe",
          stripe_payment_method_id: "pm_stale",
          stripe_account_holder_id: "cus_stale",
          setup_intent_id: "seti_stale",
          stripe_payment_intent_id: "pi_stale",
          stripe_charge_id: "ch_stale",
          final_charge_consent_version: "v1",
          final_charge_consent_text: "stale consent",
          final_charge_consented_at: "2026-07-01T00:00:00.000Z",
        },
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
    expect(meta.stripe_provider_id).toBeUndefined()
    expect(meta.stripe_payment_method_id).toBeUndefined()
    expect(meta.stripe_account_holder_id).toBeUndefined()
    expect(meta.setup_intent_id).toBeUndefined()
    expect(meta.final_charge_consent_version).toBeUndefined()
    expect(meta.final_charge_consent_text).toBeUndefined()
    expect(meta.final_charge_consented_at).toBeUndefined()
    expect(meta.payment_setup_status).toBe("not_applicable_invoice")
    expect(meta.final_charge_status).toBe("not_applicable_invoice")
  })

  it("carries the finalized catch-weight economics, shipper ListID, and customer instructions into A/R metadata", () => {
    const meta = invoiceArOrderMetadata({
      order: {
        id: "order_inv_finalized",
        metadata: {
          payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR,
          orderNotes:
            "  Please do not charge my card\n until after delivery.  ",
          deliveryInstructions: "Call from the loading dock.",
        },
      },
      finalization: {
        id: "fin_finalized",
        final_order_total: 143.42,
        currency_code: "usd",
        estimated_order_total: 130,
        final_item_total: 120.92,
        final_shipping_total: 22.5,
        final_tax_total: 0,
        final_discount_total: 0,
        delta_total: 13.42,
      },
      lines: [
        {
          line_item_id: "ordli_1",
          product_id: "prod_1",
          variant_id: "variant_1",
          customer_title: "Ground Beef 85/15 - 1 lb Pack",
          title_snapshot: "Legacy Ground Beef",
          sku: "GB-85",
          qbd_list_id: "QBD-ORIGINAL",
          replacement_qbd_list_id: "QBD-FINAL",
          pricing_mode: "per_lb",
          ordered_quantity: 2,
          actual_quantity: 2,
          actual_piece_count: 3,
          actual_weight_total: 4.12,
          actual_unit_price: 14.99,
          final_line_subtotal: 61.76,
          final_line_total: 61.76,
          delta_line_total: 9.76,
          status: "substituted",
          note: "Use the firmer packs.",
          replacement_variant_id: "variant_final",
          replacement_reason: "Approved replacement",
          metadata: { staff_added_line: false },
        },
      ],
      packages: [
        {
          id: "gpfinpkg_1",
          package_type: "Polystyrene Container 24x17x13",
          shipper_qbd_list_id: "SHIPPER-QBD-LIST-ID",
          count: 1,
          packed_weight_lb: 18.4,
          dry_ice_lb: 5,
          note: "Large cooler",
        },
      ],
    }) as Record<string, any>

    expect(meta.catch_weight_final_lines).toEqual([
      expect.objectContaining({
        line_item_id: "ordli_1",
        qbd_list_id: "QBD-FINAL",
        pricing_mode: "per_lb",
        actual_quantity: 2,
        actual_piece_count: 3,
        actual_weight_total: 4.12,
        actual_unit_price: 14.99,
        final_line_subtotal: 61.76,
        final_line_total: 61.76,
        delta_line_total: 9.76,
        replacement_variant_id: "variant_final",
        replacement_qbd_list_id: "QBD-FINAL",
      }),
    ])
    expect(meta.catch_weight_packages).toEqual([
      expect.objectContaining({
        package_type: "Polystyrene Container 24x17x13",
        shipper_qbd_list_id: "SHIPPER-QBD-LIST-ID",
        packed_weight_lb: 18.4,
      }),
    ])
    expect(meta.customer_order_instructions).toBe(
      "Please do not charge my card until after delivery. | Call from the loading dock."
    )
    expect(meta.final_total).toBe(143.42)
    expect(meta.qbd_posting_amount).toBe(14342)
  })

  it("scrubs stale card and failed-charge state before an invoice cart becomes an order", () => {
    const original = {
      keep_me: "customer context",
      stripe_payment_method_id: "pm_stale",
      setup_intent_id: "seti_stale",
      payment_setup_status: "saved",
      final_charge_status: "not_started",
      final_charge_consent_text: "stale consent",
      stripe_payment_intent_id: "pi_stale",
      stripe_failure_code: "card_declined",
      final_charge_failed_at: "2026-07-01T00:00:00.000Z",
      final_charge_recording_failure_message: "stale failure",
    }

    expect(withoutCardPaymentMetadata(original)).toEqual({
      keep_me: "customer context",
    })
    expect(original.stripe_payment_method_id).toBe("pm_stale")
  })

  it("keeps combined customer instructions stable across repeated finalization", () => {
    const order = {
      metadata: {
        orderNotes: "Leave at the front desk.",
        deliveryInstructions: "Call on arrival.",
      },
    }
    const first = finalizedCatchWeightOrderMetadata({
      order,
      lines: [],
      packages: [],
    }).customer_order_instructions
    const second = finalizedCatchWeightOrderMetadata({
      order: {
        metadata: {
          ...order.metadata,
          customer_order_instructions: first,
        },
      },
      lines: [],
      packages: [],
    }).customer_order_instructions

    expect(first).toBe("Leave at the front desk. | Call on arrival.")
    expect(second).toBe(first)
  })

  it("preserves an explicit zero final unit price", () => {
    const metadata = finalizedCatchWeightOrderMetadata({
      order: { metadata: {} },
      lines: [
        {
          line_item_id: "ordli_comped",
          actual_unit_price: 0,
          unit_price: 19.99,
          final_line_subtotal: 0,
        },
      ],
      packages: [],
    })

    expect(metadata.catch_weight_final_lines[0].actual_unit_price).toBe(0)
  })
})
