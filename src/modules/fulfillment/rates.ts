export const FREE_DELIVERY_ELIGIBLE_METADATA_KEY = "free_delivery_eligible"

type LineItemLike = {
  unit_price?: number | null
  quantity?: number | null
  subtotal?: number | null
  total?: number | null
  metadata?: Record<string, unknown> | null
}

export type AtlantaDeliveryZoneRate = {
  FreeDeliveryThresholdCents?: number | null
  // Legacy 5-tier fields (kept for back-compat / fallback).
  Rate250PlusCents?: number | null
  Rate150To249Cents?: number | null
  Rate100To149Cents?: number | null
  Rate50To99Cents?: number | null
  Rate0To49Cents?: number | null
  // New Strapi 7-band fields. Each band falls back to the matching legacy
  // tier when null/undefined, so behavior is unchanged until Peter tunes them.
  Rate1To29Cents?: number | null
  Rate30To49Cents?: number | null
  Rate50To99BandCents?: number | null
  Rate100To149BandCents?: number | null
  Rate150To249BandCents?: number | null
  Rate250To349Cents?: number | null
  Rate350PlusCents?: number | null
}

function metadataFlagIsFalse(value: unknown) {
  return value === false || value === "false" || value === 0 || value === "0"
}

export function lineItemQualifiesForFreeDelivery(item: LineItemLike): boolean {
  return !metadataFlagIsFalse(
    item.metadata?.[FREE_DELIVERY_ELIGIBLE_METADATA_KEY]
  )
}

export function lineItemSubtotalCents(item: LineItemLike): number {
  return Math.round(lineItemSubtotalAmount(item) * 100)
}

export function lineItemSubtotalAmount(item: LineItemLike): number {
  const direct = item.subtotal ?? item.total
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return Math.max(0, direct)
  }
  const unit = typeof item.unit_price === "number" ? item.unit_price : 0
  const quantity = typeof item.quantity === "number" ? item.quantity : 0
  return Math.max(0, unit * quantity)
}

export function eligibleSubtotalAmount(items: LineItemLike[] = []): number {
  return items.reduce(
    (sum, item) =>
      lineItemQualifiesForFreeDelivery(item)
        ? sum + lineItemSubtotalAmount(item)
        : sum,
    0
  )
}

export function eligibleSubtotalCents(items: LineItemLike[] = []): number {
  return items.reduce(
    (sum, item) =>
      lineItemQualifiesForFreeDelivery(item)
        ? sum + lineItemSubtotalCents(item)
        : sum,
    0
  )
}

// Charge for the $250+ bands when the order is BELOW the free-delivery
// threshold (we've already returned free at/above it). The legacy
// `Rate250PlusCents = 0` is a "free at $250+" sentinel that is only valid when
// free delivery actually starts at $250. If a zone's FreeDeliveryThresholdCents
// was raised above $250, an order sitting in the $250-349.99 / $350+ bands is
// still BELOW that zone's free threshold and must be charged — so a null/zero
// band fails closed to the highest real lower-band rate instead of granting
// free shipping. A positive band value is always honored.
function upperBandChargeCents(
  zone: AtlantaDeliveryZoneRate,
  bandValue: number | null | undefined
): number {
  if (typeof bandValue === "number" && bandValue > 0) return bandValue
  // bandValue is null or 0. Preserve back-compat: a legacy zone whose
  // Rate250PlusCents is a real positive $250+ charge still falls back to it.
  // Only when Rate250PlusCents is also 0/null — the "free at $250+" sentinel —
  // do we fail closed to the highest real lower-band charge, so a raised free
  // threshold can't make these bands free below it.
  if (typeof zone.Rate250PlusCents === "number" && zone.Rate250PlusCents > 0) {
    return zone.Rate250PlusCents
  }
  return zone.Rate150To249BandCents ?? zone.Rate150To249Cents ?? 0
}

export function atlantaDeliveryRateCents(
  zone: AtlantaDeliveryZoneRate,
  eligibleSubtotal: number
): number {
  const freeThreshold = zone.FreeDeliveryThresholdCents ?? 25000
  // At/above the free-delivery threshold, delivery is free regardless of any
  // band value (a non-zero top band must never charge above the free line).
  if (eligibleSubtotal >= freeThreshold) {
    return 0
  }
  // New 7-band selection (thresholds in cents). Each new band falls back to the
  // matching legacy tier when null/undefined, so behavior is unchanged until
  // Peter tunes the new bands in Strapi. The $250+ bands fail closed (see
  // upperBandChargeCents) so a raised free threshold can't make them free.
  if (eligibleSubtotal >= 35000) {
    return upperBandChargeCents(zone, zone.Rate350PlusCents)
  }
  if (eligibleSubtotal >= 25000) {
    return upperBandChargeCents(zone, zone.Rate250To349Cents)
  }
  if (eligibleSubtotal >= 15000) {
    return zone.Rate150To249BandCents ?? zone.Rate150To249Cents ?? 0
  }
  if (eligibleSubtotal >= 10000) {
    return zone.Rate100To149BandCents ?? zone.Rate100To149Cents ?? 0
  }
  if (eligibleSubtotal >= 5000) {
    return zone.Rate50To99BandCents ?? zone.Rate50To99Cents ?? 0
  }
  if (eligibleSubtotal >= 3000) {
    return zone.Rate30To49Cents ?? zone.Rate0To49Cents ?? 0
  }
  return zone.Rate1To29Cents ?? zone.Rate0To49Cents ?? 0
}
