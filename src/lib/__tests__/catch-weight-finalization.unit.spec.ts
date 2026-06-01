import {
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  amountInMinorUnits,
  buildFinalizationLineSnapshot,
  finalChargeOrderMetadata,
  fulfillmentGateAllowsShipment,
} from "../catch-weight-finalization"

describe("catch-weight finalization helpers", () => {
  it("blocks fulfillment until the final charge succeeds", () => {
    expect(
      fulfillmentGateAllowsShipment({
        id: "order_123",
        metadata: {
          payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
          final_charge_status: "not_started",
        },
      })
    ).toBe(false)

    expect(
      fulfillmentGateAllowsShipment({
        id: "order_123",
        metadata: {
          payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
          final_charge_status: "succeeded",
        },
      })
    ).toBe(true)
  })

  it("converts final charge amounts to Stripe minor units", () => {
    expect(amountInMinorUnits(101.95, "usd")).toBe(10195)
    expect(amountInMinorUnits(1200, "jpy")).toBe(1200)
  })

  it("creates per-lb line snapshots that require actual weight", () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_123" },
      {
        id: "item_123",
        title: "Brisket",
        variant_id: "variant_123",
        variant_sku: "10-10",
        quantity: 1,
        unit_price: 25,
        subtotal: 25,
        total: 25,
        metadata: {
          pricing_mode: "per_lb",
          qbd_list_id: "80000001-123",
          approximate_pack_weight: "2 lb",
        },
      },
      "gpfin_123"
    )

    expect(line.pricing_mode).toBe("per_lb")
    expect(line.status).toBe("needs_weight")
    expect(line.estimated_weight_total).toBe(2)
    expect(line.qbd_list_id).toBe("80000001-123")
  })

  it("summarizes a successful final charge for order metadata and QBD posting", () => {
    const metadata = finalChargeOrderMetadata({
      order: { id: "order_123", metadata: {} },
      finalization: {
        id: "gpfin_123",
        estimated_order_total: 100,
        final_order_total: 106.5,
        delta_total: 6.5,
        currency_code: "usd",
      },
      paymentIntent: {
        id: "pi_123",
        latest_charge: "ch_123",
      },
      attemptId: "gpcharge_123",
      actorId: "user_123",
    }) as Record<string, any>

    expect(metadata.final_charge_status).toBe("succeeded")
    expect(metadata.fulfillment_gate_status).toBe("released")
    expect(metadata.stripe_payment_intent_id).toBe("pi_123")
    expect(metadata.qbd_posting_action).toBe(
      "final_card_charge_accounting_record"
    )
    expect(metadata.qbd_posting_amount).toBe(10650)
  })
})
