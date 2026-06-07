import countyRates from "./data/ga-county-rates.json"
import qbdFoodTaxItems from "./data/qbd-food-tax-items-by-county.json"
import zipToCounty from "./data/ga-zip-to-county.json"

const GEORGIA_STATE_FOOD_EXEMPT_RATE = 4
const DEFAULT_GA_FULL_RATE = 8

type QuickBooksTaxItem = {
  listId: string
  fullName: string
  rate: number
}

export type FoodTaxResolution = {
  state: string | null
  county: string | null
  itemRate: number
  qbdTaxItem: QuickBooksTaxItem | null
  qbdSalesTaxCodeFullName: "Tax" | "Non"
  qbdShippingSalesTaxCodeFullName: "Non"
}

export type GeorgiaFoodTaxResolution = FoodTaxResolution

const countyRatesByName = countyRates as Record<string, number>
const qbdTaxItemsByCounty = qbdFoodTaxItems as Record<string, QuickBooksTaxItem>
const zipToCountyByZip = zipToCounty as Record<string, string>

const outOfStateTaxItem: QuickBooksTaxItem = {
  listId: "10000-1101503700",
  fullName: "OS",
  rate: 0,
}

export function georgiaCountyForPostalCode(postalCode?: string | null): string | null {
  if (!postalCode) {
    return null
  }

  return zipToCountyByZip[postalCode.trim().substring(0, 5)] ?? null
}

export function georgiaFoodTaxRateForCounty(county: string | null): number {
  const qbdRate = county ? qbdTaxItemsByCounty[county]?.rate : null
  if (qbdRate != null) {
    return qbdRate
  }

  const fullRate = county ? countyRatesByName[county] : null
  const rate = fullRate ?? DEFAULT_GA_FULL_RATE

  return Math.max(0, Number((rate - GEORGIA_STATE_FOOD_EXEMPT_RATE).toFixed(4)))
}

export function resolveGeorgiaFoodTaxForPostalCode(
  postalCode?: string | null
): GeorgiaFoodTaxResolution {
  const county = georgiaCountyForPostalCode(postalCode)
  const itemRate = georgiaFoodTaxRateForCounty(county)

  return {
    state: "GA",
    county,
    itemRate,
    qbdTaxItem: county ? qbdTaxItemsByCounty[county] ?? null : null,
    qbdSalesTaxCodeFullName: itemRate > 0 ? "Tax" : "Non",
    qbdShippingSalesTaxCodeFullName: "Non",
  }
}

export function normalizeProvinceCode(province?: string | null): string | null {
  const value = province?.trim()
  if (!value) {
    return null
  }

  const lower = value.toLowerCase()
  if (lower === "georgia") {
    return "GA"
  }

  return value.length === 2 ? value.toUpperCase() : value
}

export function resolveFoodTaxForAddress(
  province?: string | null,
  postalCode?: string | null
): FoodTaxResolution {
  const state = normalizeProvinceCode(province)

  if (state === "GA") {
    return resolveGeorgiaFoodTaxForPostalCode(postalCode)
  }

  return {
    state,
    county: null,
    itemRate: 0,
    qbdTaxItem: state ? outOfStateTaxItem : null,
    qbdSalesTaxCodeFullName: "Non",
    qbdShippingSalesTaxCodeFullName: "Non",
  }
}
