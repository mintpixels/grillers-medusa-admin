import {
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  amountInMinorUnits,
  buildFinalizationLineSnapshot,
  finalChargeOrderMetadata,
  fulfillmentGateAllowsShipment,
  orderPlacedFinalizationMetadata,
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

  it("normalizes Medusa detail line quantities and infers per-lb pricing from customer copy", () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_123" },
      {
        id: "item_123",
        title:
          "Veal Scallopini, 5-8 Slices, ~1 lb., Uncooked, Kosher for Passover. $36.99/lb.",
        variant_id: "variant_123",
        variant_sku: "2-06-11-1",
        detail: {
          quantity: { value: "1", precision: 20 },
          unit_price: { value: "36.99", precision: 20 },
          subtotal: { value: "36.99", precision: 20 },
          total: { value: "39.856725", precision: 20 },
          tax_total: { value: "2.866725", precision: 20 },
        },
        variant: {
          metadata: {
            qbd_list_id: "410000-1102714368",
          },
        },
        metadata: {},
      },
      "gpfin_123"
    )

    expect(line.pricing_mode).toBe("per_lb")
    expect(line.status).toBe("needs_weight")
    expect(line.ordered_quantity).toBe(1)
    expect(line.actual_quantity).toBe(1)
    expect(line.estimated_weight_total).toBe(1)
    expect(line.estimated_line_total).toBeCloseTo(39.856725)
    expect(line.qbd_list_id).toBe("410000-1102714368")
  })

  it("treats explicit pound pack meat copy as a weight-finalized line", () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_123" },
      {
        id: "item_ground_beef",
        title:
          "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover.",
        variant_id: "variant_ground_beef",
        variant_sku: "1-00-12-1",
        quantity: 1,
        unit_price: 11.52,
        subtotal: 11.52,
        total: 11.52,
        metadata: {
          qbd_list_id: "60000-1102339574",
        },
      },
      "gpfin_123"
    )

    expect(line.pricing_mode).toBe("per_lb")
    expect(line.status).toBe("needs_weight")
    expect(line.estimated_weight_total).toBe(1)
    expect(line.final_line_total).toBeNull()
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

  it("marks every placed order as catch-weight finalization gated", () => {
    const metadata = orderPlacedFinalizationMetadata(
      {
        id: "order_123",
        total: 100,
        metadata: {
          stripe_payment_method_id: "pm_123",
          staff_note: "leave intact",
        },
      },
      {
        id: "gpfin_123",
        status: "pending_pack",
        estimated_order_total: 100,
      }
    ) as Record<string, any>

    expect(metadata.payment_workflow).toBe(
      PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE
    )
    expect(metadata.payment_setup_status).toBe("saved")
    expect(metadata.catch_weight_status).toBe("pending_pack")
    expect(metadata.finalization_id).toBe("gpfin_123")
    expect(metadata.finalization_status).toBe("pending_pack")
    expect(metadata.final_charge_status).toBe("not_started")
    expect(metadata.fulfillment_gate_status).toBe(
      "blocked_until_final_charge"
    )
    expect(metadata.staff_note).toBe("leave intact")
  })

  it("surfaces missing saved-card setup when an order bypasses catch-weight checkout", () => {
    const metadata = orderPlacedFinalizationMetadata(
      {
        id: "order_123",
        total: 100,
        metadata: {},
      },
      {
        id: "gpfin_123",
        status: "pending_pack",
        estimated_order_total: 100,
      }
    ) as Record<string, any>

    expect(metadata.payment_setup_status).toBe("missing_saved_card")
    expect(metadata.fulfillment_gate_status).toBe(
      "blocked_until_final_charge"
    )
  })
})
