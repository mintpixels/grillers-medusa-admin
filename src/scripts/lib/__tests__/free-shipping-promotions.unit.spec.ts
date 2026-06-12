import { FREE_SHIPPING_PROMOTION_SPECS } from "../free-shipping-promotions"

describe("free shipping promotion specs", () => {
  it("uses the documented $20 Southeast Pickup credit", () => {
    const sePickupCredit = FREE_SHIPPING_PROMOTION_SPECS.find(
      (spec) => spec.code === "GP_SE_PICKUP_CREDIT"
    )

    expect(sePickupCredit?.application_method).toEqual(
      expect.objectContaining({
        target_type: "order",
        value: 20,
        currency_code: "usd",
      })
    )
  })
})
