import { ITaxProvider, Logger } from "@medusajs/framework/types"
import type { TaxTypes } from "@medusajs/framework/types"

import {
  georgiaCountyForPostalCode,
  normalizeProvinceCode,
  resolveGeorgiaFoodTaxForPostalCode,
} from "./rules"

type InjectedDependencies = {
  logger: Logger
}

export default class GeorgiaTaxProvider implements ITaxProvider {
  static identifier = "ga-tax"

  protected logger_: Logger

  constructor({ logger }: InjectedDependencies) {
    this.logger_ = logger
  }

  getIdentifier(): string {
    return GeorgiaTaxProvider.identifier
  }

  private getGeorgiaFoodRate(postalCode?: string): number | null {
    if (!postalCode) return null

    const zip = postalCode.trim().substring(0, 5)
    const county = georgiaCountyForPostalCode(zip)

    if (!county) {
      this.logger_.warn(`GA Tax: No county found for zip ${zip}, using default food tax rate`)
    }

    return resolveGeorgiaFoodTaxForPostalCode(postalCode).itemRate
  }

  async getTaxLines(
    itemLines: TaxTypes.ItemTaxCalculationLine[],
    shippingLines: TaxTypes.ShippingTaxCalculationLine[],
    context: TaxTypes.TaxCalculationContext
  ): Promise<(TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[]> {
    const provinceCode = normalizeProvinceCode(context.address?.province_code)
    const postalCode = context.address?.postal_code

    const itemRate = provinceCode === "GA"
      ? this.getGeorgiaFoodRate(postalCode)
      : 0
    const itemName =
      provinceCode === "GA" && itemRate != null
        ? `GA Food Tax (${itemRate}%)`
        : "Out-of-state Tax Exempt"

    const taxLines: (TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO)[] =
      itemLines.flatMap((l) =>
        l.rates.map((r) => ({
          rate_id: r.id,
          rate: itemRate ?? r.rate ?? 0,
          name: itemName,
          code: r.code,
          line_item_id: l.line_item.id,
          provider_id: this.getIdentifier(),
        }))
      )

    const shippingTaxLines = shippingLines.flatMap((l) =>
      l.rates.map((r) => ({
        rate_id: r.id,
        rate: 0,
        name: "Shipping Tax Exempt",
        code: r.code,
        shipping_line_id: l.shipping_line.id,
        provider_id: this.getIdentifier(),
      }))
    )

    return [...taxLines, ...shippingTaxLines]
  }
}
