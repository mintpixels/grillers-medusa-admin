import { ITaxProvider, Logger } from "@medusajs/framework/types"
import type { TaxTypes } from "@medusajs/framework/types"

import zipToCounty from "./data/ga-zip-to-county.json"
import countyRates from "./data/ga-county-rates.json"

type InjectedDependencies = {
  logger: Logger
}

const DEFAULT_GA_RATE = 8.0

export default class GeorgiaTaxProvider implements ITaxProvider {
  static identifier = "ga-tax"

  protected logger_: Logger
  protected zipToCounty_: Record<string, string>
  protected countyRates_: Record<string, number>

  constructor({ logger }: InjectedDependencies) {
    this.logger_ = logger
    this.zipToCounty_ = zipToCounty as Record<string, string>
    this.countyRates_ = countyRates as Record<string, number>
  }

  getIdentifier(): string {
    return GeorgiaTaxProvider.identifier
  }

  private getGeorgiaRate(postalCode?: string): number | null {
    if (!postalCode) return null

    const zip = postalCode.trim().substring(0, 5)
    const county = this.zipToCounty_[zip]

    if (!county) {
      this.logger_.warn(`GA Tax: No county found for zip ${zip}, using default ${DEFAULT_GA_RATE}%`)
      return DEFAULT_GA_RATE
    }

    const rate = this.countyRates_[county]
    if (rate == null) {
      this.logger_.warn(`GA Tax: No rate found for county ${county}, using default ${DEFAULT_GA_RATE}%`)
      return DEFAULT_GA_RATE
    }

    return rate
  }

  async getTaxLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    context: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    const provinceCode = context.address?.province_code?.toLowerCase()
    const postalCode = context.address?.postal_code

    const gaRate = provinceCode === "ga"
      ? this.getGeorgiaRate(postalCode)
      : null

    const taxLines: (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] =
      itemLines.flatMap((l) =>
        l.rates.map((r) => ({
          rate_id: r.id,
          rate: gaRate ?? r.rate ?? 0,
          name: gaRate != null ? `GA Tax (${gaRate}%)` : r.name,
          code: r.code,
          line_item_id: l.line_item.id,
          provider_id: this.getIdentifier(),
        }))
      )

    const shippingTaxLines = shippingLines.flatMap((l) =>
      l.rates.map((r) => ({
        rate_id: r.id,
        rate: gaRate ?? r.rate ?? 0,
        name: gaRate != null ? `GA Tax (${gaRate}%)` : r.name,
        code: r.code,
        shipping_line_id: l.shipping_line.id,
        provider_id: this.getIdentifier(),
      }))
    )

    return [...taxLines, ...shippingTaxLines]
  }
}
