import {
  isCustomerVisibleLegacyLine,
  legacyPurchaseHistoryKey,
  legacyPurchaseDisplayTitle,
  legacyLineKind,
  serializeLegacyOrderLine,
} from "../legacy-order-history"

describe("legacy order history line visibility", () => {
  it.each([
    [{ sku: "Subtotal", title: "Subtotal", description: "Subtotal" }, "subtotal"],
    [{ sku: "CCC", title: "CCC", description: "2% credit/debit card processing recovery fee" }, "fee"],
    [{ sku: "Pick Up", title: "Pick Up", description: "Customer Pick Up" }, "fulfillment"],
    [{ sku: "UPS Ground 1", title: "UPS Ground 1", description: "UPS Ground" }, "fulfillment"],
    [{ sku: "FedexGround", title: "FedexGround", description: "Customer will call to discuss" }, "fulfillment"],
    [{ sku: "FedexOvernight", title: "FedexOvernight", description: "Customer's Account" }, "fulfillment"],
    [{ sku: "Postal-FRB2", title: "Postal-FRB2", description: "USPS- FRB2 Medium 11x3x13" }, "fulfillment"],
    [{ sku: "Del - Memphis", title: "Del - Memphis", description: "Delivery Memphis" }, "fulfillment"],
    [{ sku: "Dry Ice", title: "Dry Ice", description: "Dry Ice" }, "fulfillment"],
    [{ sku: "Pick- Up Discount", title: "Pick- Up Discount", description: "Pick Up Discount" }, "discount"],
    [{ mapping_status: "non_product", metadata: { line_kind: "note" } }, "note"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "" }, "note"],
    [{ sku: "Misc. Credit", title: "Misc. Credit", description: "" }, "discount"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "5% commission" }, "fee"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "paid by check" }, "fee"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "paid by check", metadata: { line_kind: "product" } }, "fee"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "Inbound Freight: 20 lb. @ $0.25/lb." }, "fulfillment"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "Custom Slicing" }, "service"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "invoice from michaels account" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "recharge correctly" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "ACTUAL WEIGHTS: total frozen weight used" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "Shopping Bags (Blue Smiley Face - heavy duty)" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "Miscellaneous Item Driver's Gratuity" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "TIP" }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "AgriStar Fuel Surcharge 106.95 lb. @ $0.06/lb." }, "note"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "1/3 of the brisket from previous order refunded" }, "discount"],
    [{ sku: "Gift Certificate", title: "Gift Certificate", description: "GIFT VOUCHER 1476 $250" }, "non_product"],
    [{ sku: "Donation", title: "Donation", description: "Donation to Tzedakah Fund" }, "non_product"],
    [{ sku: "Bad Check", title: "Bad Check", description: "Returned Check" }, "adjustment"],
    [{ sku: "Bad Debt", title: "Bad Debt", description: "" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "cc dispute charge was incorrect. rebill" }, "adjustment"],
    [{ sku: "Miscellanous Item", title: "Miscellanous Item", description: "Repayment for AmEX chargeback in March 2020" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "Rachel Friedberg Inv. # 85665" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "applied to Chilla Beverages instead of this accout" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "put under wrong Glen Appelbaum account" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "charged Yeudah Lipszyc instead" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "moved to her other account" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "she received wrong product" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "did not want Shor Habor cutlets" }, "adjustment"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "Venmo" }, "adjustment"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "fix" }, "adjustment"],
    [{ sku: "Staff Allowance", title: "Staff Allowance", description: "Staff Allowance" }, "note"],
    [{ sku: "Bulk Case Repack", title: "Bulk Case Repack", description: "Bulk Case Repack Charge| Paying by Card" }, "service"],
    [{ sku: "Misc. Services", title: "Misc. Services", description: "REPACKING CASE ITEM ABOVE" }, "service"],
    [{ sku: "Macon", title: "Macon", description: "Macon Sales Tax" }, "fee"],
    [{ sku: "Decatur Sales Tax", title: "Decatur Sales Tax", description: "Decatur Sales Tax" }, "fee"],
    [{ sku: "Misc. Item", title: "Misc. Item", description: "Please note that prices are extremely volatile at this time" }, "note"],
    [{ sku: "Miscellaneous Item", title: "Miscellaneous Item", description: "Miscellaneous Dallas Commision 5%" }, "fee"],
    [{ sku: "Misc. Services", title: "Misc. Services", description: "50 cent stamp charge" }, "note"],
  ])("classifies non-product QuickBooks line %#", (row, expected) => {
    expect(legacyLineKind(row)).toBe(expected)
    expect(isCustomerVisibleLegacyLine(row)).toBe(false)
  })

  it("keeps an unmapped real product line visible to reorder history", () => {
    const row = {
      sku: "1-76-25-1",
      title: "1-76-25-1",
      description: "Skirt Steak, Boneless, Kosher for Passover.",
      mapping_status: "unmapped",
      metadata: { line_kind: "product" },
    }

    expect(legacyLineKind(row)).toBe("product")
    expect(isCustomerVisibleLegacyLine(row)).toBe(true)
  })

  it("does not classify product descriptions with wing tip as gratuity notes", () => {
    const row = {
      qbd_item_list_id: "750000-1102879083",
      sku: "Misc. Item",
      title: "Misc. Item",
      description: "Chicken Wings, Wing Tip On @ $2.69",
      line_total: "245.33",
      mapping_status: "unmapped",
      metadata: { line_kind: "product" },
    }

    expect(legacyLineKind(row)).toBe("product")
    expect(isCustomerVisibleLegacyLine(row)).toBe(true)
  })

  it("keeps custom product descriptions visible when they only reference a prior invoice", () => {
    const row = {
      qbd_item_list_id: "750000-1102879083",
      sku: "Misc. Item",
      title: "Misc. Item",
      description:
        "Combination of Chicken Breast Tenders and Chicken Cutlets cut into the shape of Chicken Breast Tenders @ $7.49/lb.\nPrepared identically to the previous order (Inv. #72121)\nNEEDS 250 lbs.",
      line_total: "1917.44",
      mapping_status: "unmapped",
      metadata: { line_kind: "product" },
    }

    expect(legacyLineKind(row)).toBe("product")
    expect(isCustomerVisibleLegacyLine(row)).toBe(true)
  })

  it("uses the product description for historical items whose title is only a legacy sku", () => {
    expect(
      legacyPurchaseDisplayTitle({
        sku: "6-01-21-1",
        title: "6-01-21-1",
        description: "Chicken 8-pce Cut-up, DAVID ELLIOT, CHK",
      })
    ).toBe("Chicken 8-pce Cut-up, DAVID ELLIOT, CHK")
  })

  it("keeps a real title when the legacy title is not just a sku", () => {
    expect(
      legacyPurchaseDisplayTitle({
        sku: "Misc. Item",
        title: "Cocktail Franks in a Blanket",
        description: "08-FKS9 Cocktail Franks in a Blanket",
      })
    ).toBe("Cocktail Franks in a Blanket")
  })

  it("uses description for generic miscellaneous item display titles", () => {
    expect(
      legacyPurchaseDisplayTitle({
        sku: "Misc. Item",
        title: "Misc. Item",
        description: "08-FKS9 Cocktail Franks in a Blanket",
      })
    ).toBe("08-FKS9 Cocktail Franks in a Blanket")
  })

  it("groups stable legacy products by qbd item id despite description changes", () => {
    const first = legacyPurchaseHistoryKey({
      id: "line_1",
      qbd_item_list_id: "800009B3-1498592193",
      sku: "6-01-21-1",
      title: "6-01-21-1",
      description: "Chicken 8-pce Cut-up, DAVID ELLIOT, CHK",
    })
    const second = legacyPurchaseHistoryKey({
      id: "line_2",
      qbd_item_list_id: "800009B3-1498592193",
      sku: "6-01-21-1",
      title: "6-01-21-1",
      description: "Chicken 8-pce Cut-up, DAVID ELLIOT, CHK Supervision",
    })

    expect(first).toBe(second)
  })

  it("splits generic miscellaneous item history by description", () => {
    const first = legacyPurchaseHistoryKey({
      id: "line_1",
      qbd_item_list_id: "750000-1102879083",
      sku: "Misc. Item",
      title: "Misc. Item",
      description: "08-FKS9 Cocktail Franks in a Blanket",
    })
    const second = legacyPurchaseHistoryKey({
      id: "line_2",
      qbd_item_list_id: "750000-1102879083",
      sku: "Misc. Item",
      title: "Misc. Item",
      description: "100 Buns for Boeries",
    })

    expect(first).not.toBe(second)
  })

  it("serializes customer-safe display metadata for legacy order lines", () => {
    const line = serializeLegacyOrderLine({
      id: "line_1",
      legacy_order_id: "order_1",
      qbd_item_list_id: "750000-1102879083",
      sku: "Misc. Item",
      title: "Misc. Item",
      description: "Chicken Wings, Wing Tip On @ $2.69",
      quantity: "2",
      unit_price: "269",
      line_total: "538",
      currency_code: "usd",
      mapping_status: "unmapped",
      metadata: { line_kind: "product" },
    })

    expect(line.customer_visible).toBe(true)
    expect(line.line_kind).toBe("product")
    expect(line.display_title).toBe("Chicken Wings, Wing Tip On @ $2.69")
  })
})
