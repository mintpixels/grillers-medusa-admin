import {
  FINALIZATION_CHARGED_READY_TO_SHIP,
  FINALIZATION_PACKED_PENDING_CHARGE,
  FINALIZATION_PACKED_PENDING_REVIEW,
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  amountInMinorUnits,
  addFinalizationLine,
  buildFinalizationLineSnapshot,
  ensureFinalizationForOrder,
  finalChargeOrderMetadata,
  fulfillmentGateAllowsShipment,
  orderPlacedFinalizationMetadata,
  previewFinalization,
  updateFinalizationLine,
  updateFinalizationPackages,
} from "../catch-weight-finalization"

function createMemoryCatchWeightDb(seed: Record<string, any[]>) {
  const tables = seed

  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => row[key] === value)

  const queryFor = (table: string) => {
    const filters: Array<(row: Record<string, any>) => boolean> = []

    const query: any = {
      where(where: Record<string, any>) {
        filters.push((row) => matches(row, where))
        return query
      },
      whereNull(field: string) {
        filters.push((row) => row[field] === null || row[field] === undefined)
        return query
      },
      orderBy() {
        return query
      },
      first() {
        return Promise.resolve((tables[table] || []).filter((row) => filters.every((filter) => filter(row)))[0])
      },
      insert(rows: any) {
        const values = Array.isArray(rows) ? rows : [rows]
        tables[table] = tables[table] || []
        tables[table].push(...values)
        return Promise.resolve(values)
      },
      update(patch: Record<string, any>) {
        const rows = (tables[table] || []).filter((row) =>
          filters.every((filter) => filter(row))
        )
        rows.forEach((row) => Object.assign(row, patch))
        return Promise.resolve(rows.length)
      },
      then(resolve: (value: any[]) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(
          (tables[table] || []).filter((row) => filters.every((filter) => filter(row)))
        ).then(resolve, reject)
      },
    }

    return query
  }

  return Object.assign(jest.fn((table: string) => queryFor(table)), { tables })
}

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

  it("creates per-lb line snapshots that start in the picking queue", () => {
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
    expect(line.status).toBe("needs_pick")
    expect(line.estimated_weight_total).toBe(2)
    expect(line.actual_quantity).toBe(0)
    expect(line.actual_piece_count).toBe(0)
    expect(line.final_line_total).toBeNull()
    expect(line.qbd_list_id).toBe("80000001-123")
  })

  it("creates fixed-price line snapshots that still require picker input", () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_fixed_snapshot" },
      {
        id: "item_boerewors",
        title: "KosherBoeries Classic Beef Boerewors (6x4 oz)",
        variant_id: "variant_boerewors",
        variant_sku: "1-09-11-1",
        quantity: 1,
        unit_price: 27.98,
        subtotal: 27.98,
        total: 27.98,
        metadata: {
          pricing_mode: "fixed",
          qbd_list_id: "DA0000-1130097021",
        },
      },
      "gpfin_fixed_snapshot"
    )

    expect(line.pricing_mode).toBe("fixed_price")
    expect(line.status).toBe("needs_pick")
    expect(line.ordered_quantity).toBe(1)
    expect(line.actual_quantity).toBe(0)
    expect(line.actual_piece_count).toBe(0)
    expect(line.final_line_total).toBeNull()
  })

  it("repairs untouched fixed-price lines that were defaulted to ordered quantity", async () => {
    const item = {
      id: "item_boerewors",
      title: "KosherBoeries Classic Beef Boerewors (6x4 oz)",
      variant_id: "variant_boerewors",
      variant_sku: "1-09-11-1",
      quantity: 1,
      unit_price: 27.98,
      subtotal: 27.98,
      total: 27.98,
      metadata: {
        pricing_mode: "fixed",
        qbd_list_id: "DA0000-1130097021",
      },
    }
    const line = buildFinalizationLineSnapshot(
      { id: "order_fixed_repair" },
      item,
      "gpfin_fixed_repair"
    )
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_fixed_repair",
          order_id: "order_fixed_repair",
          status: "pending_pick",
          estimated_order_total: 27.98,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          actual_quantity: 1,
          actual_piece_count: 1,
          status: "needs_pick",
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const detail = await ensureFinalizationForOrder(db, {
      id: "order_fixed_repair",
      total: 27.98,
      item_subtotal: 27.98,
      tax_total: 0,
      shipping_total: 0,
      discount_total: 0,
      items: [item],
    })

    expect(detail.lines[0].actual_quantity).toBe(0)
    expect(detail.lines[0].actual_piece_count).toBe(0)
    expect(db.tables.gp_order_finalization_line[0].actual_quantity).toBe(0)
    expect(db.tables.gp_order_finalization_line[0].actual_piece_count).toBe(0)
  })

  it("does not use ordered fixed-price quantity as fulfilled quantity in preview", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_fixed_missing_actual" },
      {
        id: "item_soup_missing_actual",
        title: "Chicken Soup",
        variant_id: "variant_soup",
        variant_sku: "10-01-11-0",
        quantity: 1,
        unit_price: 12,
        subtotal: 12,
        total: 12,
        metadata: {
          pricing_mode: "fixed",
          qbd_list_id: "QBD-SOUP",
        },
      },
      "gpfin_fixed_missing_actual"
    )
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_fixed_missing_actual",
          order_id: "order_fixed_missing_actual",
          status: "packing",
          estimated_order_total: 12,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          actual_quantity: null,
          actual_piece_count: null,
          status: "ready",
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_fixed_missing_actual",
        total: 12,
        item_subtotal: 12,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      { persist: true }
    )

    expect(preview.errors).toEqual([
      {
        line_item_id: "item_soup_missing_actual",
        message: "Fulfilled quantity must be greater than zero.",
      },
    ])
    expect(preview.lines[0].final_line_total).toBeNull()
    expect(preview.totals.final_order_total).toBeNull()
  })

  it("adds a staff-entered fixed-price item as a ready finalization line", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_added",
          order_id: "order_added",
          status: "picking",
          estimated_order_total: 0,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const line = await addFinalizationLine(
      db,
      {
        id: "order_added",
        total: 0,
        item_subtotal: 0,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      {
        product_id: "prod_soup",
        variant_id: "variant_soup",
        sku: "10-01-11-0",
        qbd_list_id: "QBD-SOUP",
        title: "Chicken Soup",
        pricing_mode: "fixed_price",
        actual_unit_price: 12,
        actual_quantity: 2,
      },
      "staff_123"
    )

    expect(line.line_item_id).toMatch(/^gpfinadd_/)
    expect(line.status).toBe("ready")
    expect(line.ordered_quantity).toBe(0)
    expect(line.actual_quantity).toBe(2)
    expect(line.metadata).toMatchObject({
      staff_added_line: true,
      staff_added_by: "staff_123",
    })
    expect(db.tables.gp_order_finalization_line).toHaveLength(1)
  })

  it("uses the true per-pound rate for final catch-weight math", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_123" },
      {
        id: "item_brisket",
        title:
          "First Cut Brisket (2-3 lb) American Angus Uncooked, Kosher for Passover. $14.99 lb.",
        variant_id: "variant_brisket",
        variant_sku: "1-03-15-0",
        quantity: 1,
        unit_price: 37.47,
        subtotal: 37.47,
        total: 40.373925,
        tax_total: 2.903925,
        metadata: {
          qbd_list_id: "970000-1105657033",
        },
      },
      "gpfin_123"
    )

    expect(line.pricing_mode).toBe("per_lb")
    expect(line.actual_unit_price).toBe(14.99)
    expect(line.estimated_line_total).toBe(40.373925)

    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: "packing",
          estimated_order_total: 40.373925,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          status: "ready",
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: 2.6,
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_123",
        total: 40.373925,
        item_subtotal: 37.47,
        tax_total: 2.903925,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      { persist: true }
    )

    expect(preview.lines[0].final_line_subtotal).toBe(38.97)
    expect(preview.lines[0].final_line_total).toBe(41.99)
    expect(preview.errors).toEqual([])
  })

  it("calculates per-lb totals from individually entered item weights", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_unit_weights" },
      {
        id: "item_ribeye",
        title: "Ribeye Steak $29.99/lb.",
        variant_id: "variant_ribeye",
        variant_sku: "1-02-03-1",
        quantity: 3,
        unit_price: 29.99,
        subtotal: 89.97,
        total: 89.97,
        metadata: {
          qbd_list_id: "QBD-RIBEYE",
        },
      },
      "gpfin_unit_weights"
    )
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_unit_weights",
          order_id: "order_unit_weights",
          status: "packing",
          estimated_order_total: 89.97,
          metadata: {},
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [{ ...line, deleted_at: null }],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })
    const order = {
      id: "order_unit_weights",
      total: 89.97,
      item_subtotal: 89.97,
      tax_total: 0,
      shipping_total: 0,
      discount_total: 0,
      items: [],
    }

    await updateFinalizationLine(db, order.id, line.line_item_id, {
      status: "ready",
      actual_unit_weights: ["1.1", "1.2", "1.35"],
    })

    const preview = await previewFinalization(db, order, { persist: true })
    const previewLine = preview.lines[0] as Record<string, any>
    expect(preview.errors).toEqual([])
    expect(previewLine.actual_quantity).toBe(3)
    expect(previewLine.actual_piece_count).toBe(3)
    expect(previewLine.actual_weight_total).toBe(3.65)
    expect(previewLine.metadata.actual_unit_weights_lb).toEqual([
      1.1,
      1.2,
      1.35,
    ])
    expect(previewLine.final_line_subtotal).toBe(109.46)
  })

  it("does not double-count free-shipping discounts in final totals", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_ups" },
      {
        id: "item_bulk",
        title: "Bulk Beef Pack ~10 lb. $10/lb.",
        variant_id: "variant_bulk",
        variant_sku: "BULK-10",
        quantity: 1,
        unit_price: 100,
        subtotal: 100,
        total: 100,
        metadata: {
          qbd_list_id: "QB-BULK-10",
        },
      },
      "gpfin_ups"
    )

    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_ups",
          order_id: "order_ups",
          status: "packing",
          estimated_order_total: 100,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          status: "ready",
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: 11,
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_ups",
        total: 100,
        item_subtotal: 100,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 20,
        items: [],
      },
      { persist: true }
    )

    expect(preview.totals.final_item_total).toBe(110)
    expect(preview.totals.final_shipping_total).toBe(0)
    expect(preview.totals.final_discount_total).toBe(0)
    expect(preview.totals.final_order_total).toBe(110)
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
    expect(line.status).toBe("needs_pick")
    expect(line.ordered_quantity).toBe(1)
    expect(line.actual_quantity).toBe(0)
    expect(line.estimated_weight_total).toBe(1)
    expect(line.estimated_line_total).toBeCloseTo(39.856725)
    expect(line.qbd_list_id).toBe("410000-1102714368")
    expect(line.customer_title).toBe("Veal Scallopini - 1 lb (5-8 slices)")
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
    expect(line.status).toBe("needs_pick")
    expect(line.estimated_weight_total).toBe(1)
    expect(line.customer_title).toBe("Ground Beef 85/15 - 1 lb Pack")
    expect(line.metadata.estimated_line_subtotal).toBe(11.52)
    expect(line.final_line_total).toBeNull()
  })

  it("repairs stale zero line estimates without losing source metadata", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: "packed_pending_review",
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          id: "gpfinline_123",
          finalization_id: "gpfin_123",
          order_id: "order_123",
          line_item_id: "item_ground_beef",
          pricing_mode: "per_lb",
          title_snapshot:
            "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover.",
          customer_title:
            "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover.",
          actual_quantity: 1,
          actual_piece_count: 1,
          metadata: {
            estimated_line_subtotal: 0,
            estimated_line_total: 0,
            estimated_tax_total: 0,
            source_line_metadata: {
              staff_note: "keep me",
            },
          },
          deleted_at: null,
        },
      ],
    })

    const detail = await ensureFinalizationForOrder(db, {
      id: "order_123",
      items: [
        {
          id: "item_ground_beef",
          title:
            "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover.",
          variant_sku: "1-00-12-1",
          quantity: 1,
          unit_price: 10.69,
          subtotal: 10.69,
          total: 11.518475,
          tax_total: 0.828475,
          metadata: {
            qbd_list_id: "60000-1102339574",
          },
        },
      ],
    })

    expect(detail.lines[0].metadata).toMatchObject({
      estimated_line_subtotal: 10.69,
      estimated_line_total: 11.518475,
      estimated_tax_total: 0.828475,
      source_line_metadata: {
        qbd_list_id: "60000-1102339574",
        staff_note: "keep me",
      },
    })
    expect(detail.lines[0].customer_title).toBe("Ground Beef 85/15 - 1 lb Pack")
  })

  it("repairs stale customer titles on charged rows without changing final money", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: FINALIZATION_CHARGED_READY_TO_SHIP,
          final_order_total: 42.45,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          id: "gpfinline_123",
          finalization_id: "gpfin_123",
          order_id: "order_123",
          line_item_id: "item_veal",
          pricing_mode: "per_lb",
          title_snapshot:
            "Veal Scallopini, 5-8 Slices, ~1 lb., Uncooked, Kosher for Passover. $36.99/lb.",
          customer_title:
            "Veal Scallopini, 5-8 Slices, ~1 lb., Uncooked, Kosher for Passover. $36.99/lb.",
          actual_weight_total: 1.07,
          final_line_subtotal: 39.58,
          final_line_total: 42.45,
          deleted_at: null,
        },
      ],
    })

    const detail = await ensureFinalizationForOrder(db, {
      id: "order_123",
      items: [
        {
          id: "item_veal",
          title:
            "Veal Scallopini, 5-8 Slices, ~1 lb., Uncooked, Kosher for Passover. $36.99/lb.",
          variant_sku: "2-06-11-1",
          quantity: 1,
          unit_price: 36.99,
          subtotal: 36.99,
          total: 39.856725,
          tax_total: 2.866725,
          metadata: {
            qbd_list_id: "410000-1102714368",
          },
        },
      ],
    })

    expect(detail.lines[0].customer_title).toBe(
      "Veal Scallopini - 1 lb (5-8 slices)"
    )
    expect(detail.lines[0].final_line_total).toBe(42.45)
  })

  it("does not calculate a final order total while required weights are missing", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: "packing",
          estimated_order_total: 11.518475,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          id: "gpfinline_123",
          finalization_id: "gpfin_123",
          order_id: "order_123",
          line_item_id: "item_ground_beef",
          qbd_list_id: "60000-1102339574",
          pricing_mode: "per_lb",
          unit_price: 10.69,
          actual_unit_price: 10.69,
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: null,
          final_line_subtotal: 0,
          final_line_total: 0,
          delta_line_total: -11.518475,
          status: "needs_weight",
          metadata: {
            estimated_line_subtotal: 10.69,
            estimated_line_total: 11.518475,
            estimated_tax_total: 0.828475,
          },
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_123",
        total: 11.518475,
        item_subtotal: 10.69,
        tax_total: 0.828475,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      { persist: true }
    )

    expect(preview.errors).toEqual([
      {
        line_item_id: "item_ground_beef",
        message: "Actual weight is required for per-lb items.",
      },
    ])
    expect(preview.lines[0].final_line_total).toBeNull()
    expect(preview.totals.final_item_total).toBeNull()
    expect(preview.totals.final_tax_total).toBeNull()
    expect(preview.totals.final_order_total).toBeNull()
    expect(preview.totals.delta_total).toBeNull()
  })

  it("lets fixed-price lines finalize from fulfilled quantity without weight", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_fixed" },
      {
        id: "item_soup",
        title: "Chicken Soup",
        variant_id: "variant_soup",
        variant_sku: "10-01-11-0",
        quantity: 2,
        unit_price: 12,
        subtotal: 24,
        total: 24,
        metadata: {
          pricing_mode: "fixed",
          qbd_list_id: "QBD-SOUP",
        },
      },
      "gpfin_fixed"
    )

    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_fixed",
          order_id: "order_fixed",
          status: "packing",
          estimated_order_total: 24,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: null,
          status: "ready",
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_fixed",
        total: 24,
        item_subtotal: 24,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      { persist: true }
    )

    expect(preview.errors).toEqual([])
    expect(preview.lines[0].final_line_total).toBe(12)
    expect(preview.totals.final_order_total).toBe(12)
  })

  it("blocks shipping orders from ready-to-charge until packages are captured", async () => {
    const line = buildFinalizationLineSnapshot(
      { id: "order_ship" },
      {
        id: "item_brisket",
        title: "First Cut Brisket ~2 lb. $14.99/lb.",
        variant_id: "variant_brisket",
        variant_sku: "1-03-15-0",
        quantity: 1,
        unit_price: 29.98,
        subtotal: 29.98,
        total: 29.98,
        metadata: {
          qbd_list_id: "QBD-BRISKET",
        },
      },
      "gpfin_ship"
    )

    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_ship",
          order_id: "order_ship",
          status: "packing",
          estimated_order_total: 49.98,
          metadata: {},
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          ...line,
          status: "ready",
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: 2,
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })
    const order = {
      id: "order_ship",
      total: 49.98,
      item_subtotal: 29.98,
      tax_total: 0,
      shipping_total: 20,
      discount_total: 0,
      shipping_methods: [
        {
          name: "UPS Ground",
          metadata: { fulfillment_type: "ups_shipping" },
        },
      ],
      items: [],
    }

    const blocked = await previewFinalization(db, order, { persist: true })
    expect(blocked.errors).toEqual([
      {
        message:
          "Shipping orders need package size, count, and packed weight before charging.",
      },
    ])
    expect(blocked.totals.final_order_total).toBeNull()

    await updateFinalizationPackages(
      db,
      order,
      [
        {
          package_type: "Shipper-345-Large",
          shipper_qbd_list_id: "8000085C-1415899425",
          count: 1,
          packed_weight_lb: 42,
          dry_ice_lb: 10,
        },
      ],
      "staff_123"
    )

    const ready = await previewFinalization(db, order, { persist: true })
    expect(ready.errors).toEqual([])
    expect(ready.packages).toMatchObject([
      {
        package_type: "Shipper-345-Large",
        shipper_qbd_list_id: "8000085C-1415899425",
        count: 1,
        packed_weight_lb: 42,
        dry_ice_lb: 10,
      },
    ])
    expect(ready.totals.final_order_total).toBeCloseTo(49.98)
    expect(db.tables.gp_order_finalization[0].status).toBe(
      FINALIZATION_PACKED_PENDING_CHARGE
    )

    await updateFinalizationPackages(
      db,
      order,
      [{ package_type: "Shipper-360-ExtraLarge", count: 1, packed_weight_lb: 46 }],
      "staff_123"
    )
    expect(db.tables.gp_order_finalization[0].status).toBe(
      FINALIZATION_PACKED_PENDING_REVIEW
    )

    await updateFinalizationPackages(
      db,
      order,
      [{ package_type: "Shipper-345-Large", count: 1, packed_weight_lb: 51 }],
      "staff_123"
    )
    const overweight = await previewFinalization(db, order, { persist: true })
    expect(overweight.errors).toContainEqual({
      message:
        "Package 1 is over 50 lb including dry ice and packaging.",
    })
  })

  it("uses replacement price for substituted catch-weight lines", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: "packed_pending_review",
          estimated_order_total: 21.38,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          id: "gpfinline_123",
          finalization_id: "gpfin_123",
          order_id: "order_123",
          line_item_id: "item_ground_beef",
          qbd_list_id: "ORIGINAL-QBD",
          pricing_mode: "per_lb",
          unit_price: 10.69,
          actual_unit_price: 12.5,
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: 2,
          replacement_variant_id: "variant_replacement",
          replacement_qbd_list_id: "REPLACEMENT-QBD",
          replacement_reason: "Substituted with a larger pack",
          status: "substituted",
          metadata: {
            estimated_line_subtotal: 21.38,
            estimated_line_total: 21.38,
            estimated_tax_total: 0,
          },
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const preview = await previewFinalization(
      db,
      {
        id: "order_123",
        total: 21.38,
        item_subtotal: 21.38,
        tax_total: 0,
        shipping_total: 0,
        discount_total: 0,
        items: [],
      },
      { persist: true }
    )

    expect(preview.errors).toEqual([])
    expect(preview.lines[0].final_line_subtotal).toBe(25)
    expect(preview.lines[0].final_line_total).toBe(25)
    expect(preview.totals.final_order_total).toBe(25)
  })

  it("keeps substituted replacement prices during line repair", async () => {
    const db = createMemoryCatchWeightDb({
      gp_order_finalization: [
        {
          id: "gpfin_123",
          order_id: "order_123",
          status: "packing",
          estimated_order_total: 10.69,
          deleted_at: null,
        },
      ],
      gp_order_finalization_line: [
        {
          id: "gpfinline_123",
          finalization_id: "gpfin_123",
          order_id: "order_123",
          line_item_id: "item_ground_beef",
          qbd_list_id: "ORIGINAL-QBD",
          pricing_mode: "per_lb",
          unit_price: 10.69,
          estimated_unit_price: 10.69,
          actual_unit_price: 14.99,
          actual_quantity: 1,
          actual_piece_count: 1,
          actual_weight_total: 1.7,
          replacement_variant_id: "variant_brisket",
          replacement_qbd_list_id: "BRISKET-QBD",
          replacement_reason: "Substituted with First Cut Brisket",
          status: "substituted",
          metadata: {
            estimated_line_subtotal: 10.69,
            estimated_line_total: 11.52,
            estimated_tax_total: 0,
          },
          deleted_at: null,
        },
      ],
      gp_order_payment_setup: [],
      gp_final_charge_attempt: [],
    })

    const order = {
      id: "order_123",
      total: 10.69,
      item_subtotal: 10.69,
      tax_total: 0,
      shipping_total: 0,
      discount_total: 0,
      items: [
        {
          id: "item_ground_beef",
          title:
            "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover.",
          variant_sku: "1-00-12-1",
          quantity: 1,
          unit_price: 10.69,
          subtotal: 10.69,
          total: 10.69,
          tax_total: 0,
          metadata: {
            qbd_list_id: "ORIGINAL-QBD",
          },
        },
      ],
    }

    const detail = await ensureFinalizationForOrder(db, order)
    expect(detail.lines[0].actual_unit_price).toBe(14.99)
    expect(detail.lines[0].replacement_variant_id).toBe("variant_brisket")

    const preview = await previewFinalization(db, order, { persist: true })
    expect(preview.errors).toEqual([])
    expect(preview.lines[0].final_line_subtotal).toBeCloseTo(25.48)
    expect(preview.totals.final_order_total).toBeCloseTo(25.48)
  })

  it("summarizes a successful final charge for order metadata and QBD posting", () => {
    const metadata = finalChargeOrderMetadata({
      order: { id: "order_123", metadata: {} },
      finalization: {
        id: "gpfin_123",
        estimated_order_total: 100,
        final_item_total: 98,
        final_shipping_total: 5,
        final_tax_total: 7.5,
        final_discount_total: 4,
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
      staffAudit: {
        staff_actor_customer_id: "cus_staff",
        staff_actor_email: "packer@example.com",
        staff_actor_name: "Packer Person",
      },
    }) as Record<string, any>

    expect(metadata.final_charge_status).toBe("succeeded")
    expect(metadata.fulfillment_gate_status).toBe("released")
    expect(metadata.stripe_payment_intent_id).toBe("pi_123")
    expect(metadata.qbd_posting_action).toBe(
      "final_card_charge_accounting_record"
    )
    expect(metadata.qbd_posting_amount).toBe(10650)
    expect(metadata.final_item_total).toBe(98)
    expect(metadata.final_shipping_total).toBe(5)
    expect(metadata.final_tax_total).toBe(7.5)
    expect(metadata.final_discount_total).toBe(4)
    const audit = JSON.parse(metadata.staff_audit_log)
    expect(audit[audit.length - 1]).toMatchObject({
      action: "final_charge_succeeded",
      staff_actor_id: "user_123",
      staff_actor_customer_id: "cus_staff",
      staff_actor_email: "packer@example.com",
      staff_actor_name: "Packer Person",
    })
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
        status: "pending_pick",
        estimated_order_total: 100,
      }
    ) as Record<string, any>

    expect(metadata.payment_workflow).toBe(
      PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE
    )
    expect(metadata.payment_setup_status).toBe("saved")
    expect(metadata.catch_weight_status).toBe("pending_pick")
    expect(metadata.finalization_id).toBe("gpfin_123")
    expect(metadata.finalization_status).toBe("pending_pick")
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
        status: "pending_pick",
        estimated_order_total: 100,
      }
    ) as Record<string, any>

    expect(metadata.payment_setup_status).toBe("missing_saved_card")
    expect(metadata.fulfillment_gate_status).toBe(
      "blocked_until_final_charge"
    )
  })
})
