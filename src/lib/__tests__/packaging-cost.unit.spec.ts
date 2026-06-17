import {
  DEFAULT_PACKAGING_CONFIG,
  estimatePackagingCost,
  packagingConfigFromEnv,
  transitDaysForOrder,
} from "../packaging-cost"

describe("transitDaysForOrder", () => {
  it("fixes air services regardless of ZIP", () => {
    expect(transitDaysForOrder("OVERNIGHT", "90048")).toBe(1)
    expect(transitDaysForOrder("2ND_DAY_AIR", "90048")).toBe(2)
    expect(transitDaysForOrder("3_DAY_SELECT", "30340")).toBe(3)
  })

  it("uses the ZIP3 table for Ground", () => {
    expect(transitDaysForOrder("GROUND", "30340")).toBe(1) // Atlanta local
    expect(transitDaysForOrder("GROUND", "10001")).toBe(3) // NYC
    expect(transitDaysForOrder("GROUND", "90048")).toBe(5) // LA
  })

  it("defaults unknown ZIPs to far (5)", () => {
    expect(transitDaysForOrder("GROUND", "00000")).toBe(5)
    expect(transitDaysForOrder("GROUND", "")).toBe(5)
  })
})

describe("estimatePackagingCost — Peter's rules (2026-06-16)", () => {
  it("1-2 day → 14 lb dry ice; single 345 box (workhorse)", () => {
    // 20 product + 14 dry ice + 3 tare = 37 gross > 33 → l345
    const r = estimatePackagingCost({
      estimatedProductWeightLb: 20,
      service: "GROUND",
      shipPostalCode: "30340",
    })
    expect(r.transitDays).toBe(1)
    expect(r.boxes).toBe(1)
    expect(r.dryIceLb).toBe(14)
    expect(r.boxTier).toBe("l345")
    expect(r.boxCost).toBeCloseTo(16.06, 2)
    expect(r.dryIceCost).toBeCloseTo(8.4, 2) // 14 * 0.60
    expect(r.total).toBeCloseTo(24.46, 2)
  })

  it("smaller order lands in the 330 medium tier", () => {
    // 12 product + 14 dry ice + 3 tare = 29 gross: > 20 and ≤ 33 → m330
    const r = estimatePackagingCost({
      estimatedProductWeightLb: 12,
      service: "OVERNIGHT",
      shipPostalCode: "10001",
    })
    expect(r.transitDays).toBe(1) // air overrides ZIP
    expect(r.dryIceLb).toBe(14)
    expect(r.boxTier).toBe("m330")
    expect(r.total).toBeCloseTo(18.38, 2) // 9.98 + 8.40
  })

  it("3-day → 21 lb dry ice per box", () => {
    const r = estimatePackagingCost({
      estimatedProductWeightLb: 20,
      service: "3_DAY_SELECT",
      shipPostalCode: "30340",
    })
    expect(r.transitDays).toBe(3)
    expect(r.boxes).toBe(1)
    expect(r.dryIceLb).toBe(21)
    expect(r.boxTier).toBe("l345")
    expect(r.dryIceCost).toBeCloseTo(12.6, 2) // 21 * 0.60
    expect(r.total).toBeCloseTo(28.66, 2)
  })

  it("splits heavy cross-country orders into multiple boxes, dry ice per box", () => {
    const r = estimatePackagingCost({
      estimatedProductWeightLb: 60,
      service: "GROUND",
      shipPostalCode: "90048", // LA, transit 5 → long
    })
    expect(r.transitDays).toBe(5)
    expect(r.boxes).toBe(3) // ceil(60 / (50 - 21 - 3)) = ceil(60/26)
    expect(r.dryIceLb).toBe(63) // 3 boxes * 21
    expect(r.boxCost).toBeCloseTo(48.18, 2) // 3 * 16.06
    expect(r.dryIceCost).toBeCloseTo(37.8, 2) // 63 * 0.60
    expect(r.total).toBeCloseTo(85.98, 2)
  })

  it("tier boundaries on GROSS billed weight (product + dry ice + tare): micro ≤ 20, m330 ≤ 33", () => {
    const tier = (w: number) =>
      estimatePackagingCost({ estimatedProductWeightLb: w, service: "GROUND", shipPostalCode: "30340" }).boxTier
    // micro/m330 boundary at 20: 3 + 14 + 3 = 20 → micro; 3.5 → 20.5 → m330
    expect(tier(3)).toBe("micro")
    expect(tier(3.5)).toBe("m330")
    // m330/l345 boundary at 33: 16 + 14 + 3 = 33 → m330; 16.5 → 33.5 → l345
    expect(tier(16)).toBe("m330")
    expect(tier(16.5)).toBe("l345")
  })

  it("never throws on degenerate input; zero weight → 1 box", () => {
    const r = estimatePackagingCost({
      estimatedProductWeightLb: 0,
      service: "GROUND",
      shipPostalCode: "30340",
    })
    expect(r.boxes).toBe(1)
    expect(r.dryIceLb).toBe(14)
    expect(r.total).toBeGreaterThan(0)
    // NaN / negative weight clamp to 0 → still 1 box
    expect(
      estimatePackagingCost({ estimatedProductWeightLb: Number.NaN, service: "GROUND", shipPostalCode: "30340" }).boxes
    ).toBe(1)
    expect(
      estimatePackagingCost({ estimatedProductWeightLb: -5, service: "GROUND", shipPostalCode: "30340" }).boxes
    ).toBe(1)
  })
})

describe("packagingConfigFromEnv", () => {
  it("defaults to Peter's confirmed numbers", () => {
    const cfg = packagingConfigFromEnv({})
    expect(cfg).toEqual(DEFAULT_PACKAGING_CONFIG)
    expect(cfg.dryIceUsdPerLb).toBe(0.6)
    expect(cfg.boxCost).toEqual({ micro: 7.54, m330: 9.98, l345: 16.06 })
  })

  it("env overrides are applied", () => {
    const cfg = packagingConfigFromEnv({ GRILLERS_DRY_ICE_USD_PER_LB: "1.00" })
    expect(cfg.dryIceUsdPerLb).toBe(1)
    const r = estimatePackagingCost(
      { estimatedProductWeightLb: 20, service: "GROUND", shipPostalCode: "30340" }, // l345
      cfg
    )
    expect(r.dryIceCost).toBeCloseTo(14, 2) // 14 lb * $1.00
    expect(r.total).toBeCloseTo(30.06, 2) // 16.06 + 14
  })

  it("ignores invalid env values (falls back to default)", () => {
    expect(packagingConfigFromEnv({ GRILLERS_DRY_ICE_USD_PER_LB: "abc" }).dryIceUsdPerLb).toBe(0.6)
    expect(packagingConfigFromEnv({ GRILLERS_DRY_ICE_USD_PER_LB: "-3" }).dryIceUsdPerLb).toBe(0.6)
  })
})

// Guards against drift from the validated reconciliation
// (analysis/packaging-cost-reconciliation.mjs): if these constants change,
// the QBD reconciliation must be re-run.
describe("constants match the reconciliation script", () => {
  it("holds Peter's spec values", () => {
    expect(DEFAULT_PACKAGING_CONFIG.dryIceUsdPerLb).toBe(0.6)
    expect(DEFAULT_PACKAGING_CONFIG.boxCost).toEqual({ micro: 7.54, m330: 9.98, l345: 16.06 })
    expect(DEFAULT_PACKAGING_CONFIG.dryIcePerBoxShortLb).toBe(14)
    expect(DEFAULT_PACKAGING_CONFIG.dryIcePerBoxLongLb).toBe(21)
    expect(DEFAULT_PACKAGING_CONFIG.maxBoxTotalLb).toBe(50)
    expect(DEFAULT_PACKAGING_CONFIG.microBilledCeilLb).toBe(20)
    expect(DEFAULT_PACKAGING_CONFIG.m330BilledCeilLb).toBe(33)
  })
})
