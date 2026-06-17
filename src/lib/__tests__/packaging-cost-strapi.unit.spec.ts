import { resolvePackagingConfig } from "../packaging-cost"
import {
  fetchPackagingOverridesFromStrapi,
  getPackagingConfig,
  packagingOverridesFromColdChainSetting,
  resetPackagingOverridesCache,
} from "../packaging-cost-strapi"

describe("resolvePackagingConfig — layering default < strapi < env", () => {
  it("defaults to Peter's numbers with no strapi/env", () => {
    const c = resolvePackagingConfig({})
    expect(c.dryIceUsdPerLb).toBe(0.6)
    expect(c.boxCost).toEqual({ micro: 7.54, m330: 9.98, l345: 16.06 })
  })

  it("Strapi overrides the default", () => {
    const c = resolvePackagingConfig({
      strapi: { dryIceUsdPerLb: 0.5, boxCost: { l345: 18.0 } },
      env: {},
    })
    expect(c.dryIceUsdPerLb).toBe(0.5)
    expect(c.boxCost.l345).toBe(18.0)
    expect(c.boxCost.micro).toBe(7.54) // untouched → default
  })

  it("env overrides Strapi", () => {
    const c = resolvePackagingConfig({
      strapi: { dryIceUsdPerLb: 0.5 },
      env: { GRILLERS_DRY_ICE_USD_PER_LB: "0.8" },
    })
    expect(c.dryIceUsdPerLb).toBe(0.8)
  })

  it("ignores invalid Strapi values (null / negative / zero) → default", () => {
    const c = resolvePackagingConfig({
      strapi: { dryIceUsdPerLb: null, boxCost: { l345: -3, m330: 0 } },
      env: {},
    })
    expect(c.dryIceUsdPerLb).toBe(0.6)
    expect(c.boxCost.l345).toBe(16.06)
    expect(c.boxCost.m330).toBe(9.98) // explicit 0 rejected → default
  })
})

describe("packagingOverridesFromColdChainSetting", () => {
  it("maps the Strapi v5 flat shape", () => {
    expect(
      packagingOverridesFromColdChainSetting({
        DryIcePricePerLb: 0.6,
        BoxCostMicro: 7.54,
        BoxCost330: 9.98,
        BoxCost345: 16.06,
      })
    ).toEqual({
      dryIceUsdPerLb: 0.6,
      boxCost: { micro: 7.54, m330: 9.98, l345: 16.06 },
    })
  })

  it("maps the Strapi v4 attributes shape", () => {
    const o = packagingOverridesFromColdChainSetting({
      attributes: { DryIcePricePerLb: 0.55 },
    })
    expect(o.dryIceUsdPerLb).toBe(0.55)
  })

  it("missing fields → null (fall back to defaults downstream)", () => {
    const o = packagingOverridesFromColdChainSetting({})
    expect(o.dryIceUsdPerLb).toBeNull()
    expect(o.boxCost).toEqual({ micro: null, m330: null, l345: null })
  })
})

describe("getPackagingConfig — fetch + cache", () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    resetPackagingOverridesCache()
  })

  it("applies Strapi values and caches within the TTL", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { DryIcePricePerLb: 0.55 } }),
    })) as any
    global.fetch = fetchMock
    const env = { STRAPI_URL: "https://strapi.test", STRAPI_TOKEN: "t" }

    const c1 = await getPackagingConfig(env, 1_000)
    const c2 = await getPackagingConfig(env, 2_000) // within TTL
    expect(c1.dryIceUsdPerLb).toBe(0.55)
    expect(c2.dryIceUsdPerLb).toBe(0.55)
    expect(fetchMock).toHaveBeenCalledTimes(1) // cached

    // past the TTL → refetch
    await getPackagingConfig(env, 1_000 + 6 * 60 * 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("falls back to defaults when Strapi fails (never throws)", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down")
    }) as any
    const c = await getPackagingConfig(
      { STRAPI_URL: "https://strapi.test" },
      Date.now()
    )
    expect(c.dryIceUsdPerLb).toBe(0.6) // default
  })

  it("returns {} overrides when STRAPI_URL is unset", async () => {
    const o = await fetchPackagingOverridesFromStrapi({})
    expect(o).toEqual({})
  })
})
