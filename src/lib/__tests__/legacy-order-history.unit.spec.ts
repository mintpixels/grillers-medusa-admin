import {
  isCustomerVisibleLegacyLine,
  legacyPurchaseDisplayTitle,
  legacyLineKind,
} from "../legacy-order-history"

describe("legacy order history line visibility", () => {
  it.each([
    [{ sku: "Subtotal", title: "Subtotal", description: "Subtotal" }, "subtotal"],
    [{ sku: "CCC", title: "CCC", description: "2% credit/debit card processing recovery fee" }, "fee"],
    [{ sku: "Pick Up", title: "Pick Up", description: "Customer Pick Up" }, "fulfillment"],
    [{ sku: "UPS Ground 1", title: "UPS Ground 1", description: "UPS Ground" }, "fulfillment"],
    [{ sku: "Del - Memphis", title: "Del - Memphis", description: "Delivery Memphis" }, "fulfillment"],
    [{ sku: "Pick- Up Discount", title: "Pick- Up Discount", description: "Pick Up Discount" }, "discount"],
    [{ mapping_status: "non_product", metadata: { line_kind: "note" } }, "note"],
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
})
