import {
  atlantaDeliveryRateCents,
  eligibleSubtotalAmount,
  eligibleSubtotalCents,
  lineItemQualifiesForFreeDelivery,
} from "../rates"

describe("fulfillment rates", () => {
  it("defaults line items to eligible for free delivery progress", () => {
    expect(lineItemQualifiesForFreeDelivery({ metadata: {} })).toBe(true)
    expect(
      lineItemQualifiesForFreeDelivery({
        metadata: { free_delivery_eligible: false },
      })
    ).toBe(false)
  })

  it("calculates checkout rate tiers from eligible subtotal only", () => {
    expect(
      eligibleSubtotalAmount([
        { unit_price: 100, quantity: 2, metadata: {} },
        {
          unit_price: 100,
          quantity: 1,
          metadata: { free_delivery_eligible: false },
        },
      ])
    ).toBe(200)

    expect(
      eligibleSubtotalCents([
        { unit_price: 100, quantity: 2, metadata: {} },
        {
          unit_price: 100,
          quantity: 1,
          metadata: { free_delivery_eligible: false },
        },
      ])
    ).toBe(20000)
  })

  it("maps Atlanta delivery structured tiers", () => {
    const zone = {
      FreeDeliveryThresholdCents: 25000,
      Rate250PlusCents: 0,
      Rate150To249Cents: 2250,
      Rate100To149Cents: 2500,
      Rate50To99Cents: 2750,
      Rate0To49Cents: 3000,
    }

    expect(atlantaDeliveryRateCents(zone, 25000)).toBe(0)
    expect(atlantaDeliveryRateCents(zone, 20000)).toBe(2250)
    expect(atlantaDeliveryRateCents(zone, 12500)).toBe(2500)
    expect(atlantaDeliveryRateCents(zone, 7500)).toBe(2750)
    expect(atlantaDeliveryRateCents(zone, 4999)).toBe(3000)
  })

  it("uses the new 7-band rates when present", () => {
    // Free threshold lifted above the $350 band so the band logic is exercised.
    const zone = {
      FreeDeliveryThresholdCents: 50000,
      // Legacy tiers set to distinct sentinel values that should NOT be hit.
      Rate250PlusCents: 9990,
      Rate150To249Cents: 9991,
      Rate100To149Cents: 9992,
      Rate50To99Cents: 9993,
      Rate0To49Cents: 9994,
      // New 7-band values.
      Rate1To29Cents: 100,
      Rate30To49Cents: 200,
      Rate50To99BandCents: 300,
      Rate100To149BandCents: 400,
      Rate150To249BandCents: 500,
      Rate250To349Cents: 600,
      Rate350PlusCents: 700,
    }

    // $1-29.99 vs $30-49.99 — a distinction the legacy 5-tier logic could NOT make.
    expect(atlantaDeliveryRateCents(zone, 1500)).toBe(100) // $15.00
    expect(atlantaDeliveryRateCents(zone, 3500)).toBe(200) // $35.00
    expect(atlantaDeliveryRateCents(zone, 7500)).toBe(300) // $75.00
    expect(atlantaDeliveryRateCents(zone, 12500)).toBe(400) // $125.00
    expect(atlantaDeliveryRateCents(zone, 20000)).toBe(500) // $200.00
    // $250-349.99 vs $350+ — also indistinguishable under the legacy logic.
    expect(atlantaDeliveryRateCents(zone, 30000)).toBe(600) // $300.00
    expect(atlantaDeliveryRateCents(zone, 40000)).toBe(700) // $400.00
  })

  it("falls back to legacy tiers when only legacy fields are set (back-compat)", () => {
    // No new 7-band fields — every band must resolve through its legacy fallback.
    const zone = {
      FreeDeliveryThresholdCents: 50000,
      Rate250PlusCents: 1000,
      Rate150To249Cents: 2250,
      Rate100To149Cents: 2500,
      Rate50To99Cents: 2750,
      Rate0To49Cents: 3000,
    }

    expect(atlantaDeliveryRateCents(zone, 40000)).toBe(1000) // $350+  → Rate250PlusCents
    expect(atlantaDeliveryRateCents(zone, 30000)).toBe(1000) // $250-349.99 → Rate250PlusCents
    expect(atlantaDeliveryRateCents(zone, 20000)).toBe(2250) // $150-249.99 → Rate150To249Cents
    expect(atlantaDeliveryRateCents(zone, 12500)).toBe(2500) // $100-149.99 → Rate100To149Cents
    expect(atlantaDeliveryRateCents(zone, 7500)).toBe(2750) // $50-99.99  → Rate50To99Cents
    expect(atlantaDeliveryRateCents(zone, 3500)).toBe(3000) // $30-49.99  → Rate0To49Cents
    expect(atlantaDeliveryRateCents(zone, 1500)).toBe(3000) // $1-29.99   → Rate0To49Cents
  })

  it("returns 0 (free) at or above the free-delivery threshold", () => {
    // Free delivery is expressed by the top rate field being 0 (Rate350Plus
    // falling back to Rate250Plus), which the free path returns at/above the
    // threshold. The lower-band fields are non-zero to prove the free path,
    // not a band, is what returns 0 here.
    const zone = {
      FreeDeliveryThresholdCents: 25000,
      Rate250PlusCents: 0,
      Rate150To249BandCents: 500,
      Rate0To49Cents: 3000,
    }

    expect(atlantaDeliveryRateCents(zone, 25000)).toBe(0)
    expect(atlantaDeliveryRateCents(zone, 99999)).toBe(0)
    // Below the free threshold a real band rate is charged.
    expect(atlantaDeliveryRateCents(zone, 20000)).toBe(500)
  })

  it("fails closed on the $250+ bands below a raised free threshold", () => {
    // Free delivery raised to $400, so the $250-349.99 and $350+ bands are
    // actually reachable below the free threshold. The seeded "free at $250+"
    // sentinels (Rate250To349/Rate350Plus = 0, legacy Rate250PlusCents = 0)
    // must NOT make a $260/$360 order free — they fall back to the highest real
    // lower-band charge.
    const zone = {
      FreeDeliveryThresholdCents: 40000, // $400
      Rate250PlusCents: 0,
      Rate250To349Cents: 0, // seeded sentinel, not a real charge
      Rate350PlusCents: 0, // seeded sentinel, not a real charge
      Rate150To249BandCents: 1500, // $15.00 fallback charge
      Rate0To49Cents: 2000,
    }
    expect(atlantaDeliveryRateCents(zone, 26000)).toBe(1500) // $260 → charged
    expect(atlantaDeliveryRateCents(zone, 36000)).toBe(1500) // $360 → charged
    expect(atlantaDeliveryRateCents(zone, 40000)).toBe(0) // $400 clears free
    // A real configured $350+ charge is still honored below the free threshold.
    const charged = { ...zone, Rate350PlusCents: 2500 }
    expect(atlantaDeliveryRateCents(charged, 36000)).toBe(2500)
  })
})
