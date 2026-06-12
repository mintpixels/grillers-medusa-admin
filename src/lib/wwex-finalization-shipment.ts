import {
  createWwexSpeedshipClientFromEnv,
  isUpsServiceCode,
  normalizeGrillersUpsServiceCode,
  type WwexBookingResult,
  type WwexOffer,
  type WwexQuoteResult,
} from "../modules/fulfillment/wwex-speedship"
import { metadataObject } from "./catch-weight-finalization"

type LoggerLike = {
  warn?: (message: string) => void
  info?: (message: string) => void
}

type FinalizationPreview = {
  finalization: Record<string, any>
  lines: Array<Record<string, any>>
  packages?: Array<Record<string, any>>
  totals: Record<string, any>
  package_capture_required?: boolean
}

export type WwexFinalizationQuote = {
  status: "quoted"
  quote: WwexQuoteResult
  offer: WwexOffer
  totals: Record<string, any>
  metadata: Record<string, any>
}

export type WwexFinalizationBooking =
  | {
      status: "booked"
      booking: WwexBookingResult
      label_status?: "available" | "not_requested" | "failed"
      metadata: Record<string, any>
    }
  | {
      status: "skipped" | "failed"
      reason: string
      metadata: Record<string, any>
    }

const numberOrZero = (value: unknown): number => {
  if (value === undefined || value === null || value === "") return 0
  const parsed =
    typeof value === "object" && value !== null && "value" in value
      ? Number((value as Record<string, unknown>).value)
      : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const roundMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100

const envFlag = (name: string, fallback = false): boolean => {
  const raw = process.env[name]
  if (!raw) return fallback
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value)
    }
  }
  return ""
}

function shippingServiceCode(order: Record<string, any>): string {
  const metadata = metadataObject(order.metadata)
  const methods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : []
  const method = methods[methods.length - 1] || {}
  const data = metadataObject(method.data)
  const optionData = metadataObject(method.shipping_option?.data)
  const normalized = normalizeGrillersUpsServiceCode(
    firstText(
      data.service_code,
      optionData.service_code,
      method.service_code,
      method.name,
      method.shipping_option?.name,
      metadata.service_code,
      metadata.shipping_service_code,
      metadata.fulfillmentType,
      metadata.fulfillment_type
    )
  )

  if (isUpsServiceCode(normalized)) return normalized

  const blob = JSON.stringify([metadata, methods]).toLowerCase()
  if (blob.includes("3 day")) return "3_DAY_SELECT"
  if (blob.includes("2nd day") || blob.includes("second day")) {
    return "2ND_DAY_AIR"
  }
  if (blob.includes("overnight") || blob.includes("next day")) return "OVERNIGHT"
  if (blob.includes("ups") || blob.includes("shipping")) return "GROUND"
  return normalized
}

function shipmentDate(order: Record<string, any>): string | null {
  const metadata = metadataObject(order.metadata)
  return (
    firstText(
      metadata.shipmentDate,
      metadata.shipment_date,
      metadata.requestedShipDate,
      metadata.requested_ship_date
    ) || null
  )
}

function packageInputs(preview: FinalizationPreview) {
  return (preview.packages || [])
    .filter((pkg) => pkg && typeof pkg === "object")
    .map((pkg) => ({
      id: pkg.id,
      package_type: pkg.package_type,
      packed_weight_lb: pkg.packed_weight_lb,
      dry_ice_lb: pkg.dry_ice_lb,
      note: pkg.note,
    }))
}

function quoteMetadata(offer: WwexOffer) {
  return {
    wwex_quote_status: "quoted",
    wwex_quote_quoted_at: new Date().toISOString(),
    wwex_offer_id: offer.offerId,
    wwex_product_transaction_id: offer.productTransactionId,
    wwex_ups_service_code: offer.upsServiceCode,
    wwex_final_rate: offer.price.value,
    wwex_final_rate_currency: offer.price.currency,
    wwex_transit_days: offer.transitDays ?? null,
    wwex_estimated_delivery_date: offer.estimatedDeliveryDate || null,
    wwex_delivery_by: offer.deliveryBy || null,
  }
}

function recalculateTotalsWithShipping(
  preview: FinalizationPreview,
  shippingAmount: number
) {
  const totals = preview.totals || {}
  const finalOrderTotal = roundMoney(
    numberOrZero(totals.final_item_total) +
      numberOrZero(shippingAmount) +
      numberOrZero(totals.final_tax_total) -
      numberOrZero(totals.final_discount_total)
  )

  return {
    ...totals,
    final_shipping_total: roundMoney(shippingAmount),
    final_order_total: finalOrderTotal,
    delta_total: roundMoney(
      finalOrderTotal - numberOrZero(preview.finalization.estimated_order_total)
    ),
  }
}

export async function quoteWwexFinalizationShipping(input: {
  order: Record<string, any>
  preview: FinalizationPreview
  logger?: LoggerLike
}): Promise<WwexFinalizationQuote | null> {
  if (!input.preview.package_capture_required) return null

  const client = createWwexSpeedshipClientFromEnv(process.env, input.logger)
  if (!client) return null

  const serviceCode = shippingServiceCode(input.order)
  if (!isUpsServiceCode(serviceCode)) return null

  const packages = packageInputs(input.preview)
  if (!packages.length) return null

  try {
    const quote = await client.quoteSmallpack({
      serviceCode,
      shippingAddress: input.order.shipping_address || {},
      packages,
      items: input.preview.lines || [],
      shipmentDate: shipmentDate(input.order),
      orderDisplayId: input.order.display_id,
      orderId: input.order.id,
      residentialDelivery: true,
    })
    return {
      status: "quoted",
      quote,
      offer: quote.offer,
      totals: recalculateTotalsWithShipping(input.preview, quote.offer.price.value),
      metadata: quoteMetadata(quote.offer),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    input.logger?.warn?.(
      `[wwex] final packed-box quote failed for order ${input.order.id}; preserving existing shipping total: ${message}`
    )
    return {
      status: "quoted",
      quote: null as any,
      offer: null as any,
      totals: input.preview.totals,
      metadata: {
        wwex_quote_status: "failed",
        wwex_quote_failed_at: new Date().toISOString(),
        wwex_quote_error: message,
      },
    }
  }
}

export async function bookWwexFinalizationShipment(input: {
  order: Record<string, any>
  quote: WwexFinalizationQuote | null
  logger?: LoggerLike
}): Promise<WwexFinalizationBooking> {
  if (!input.quote?.quote?.offer) {
    return {
      status: "skipped",
      reason: "no_wwex_quote",
      metadata: {
        wwex_booking_status: "skipped",
        wwex_booking_reason: "no_wwex_quote",
      },
    }
  }

  if (!envFlag("WWEX_BOOK_SHIPMENTS_ON_RELEASE", false)) {
    return {
      status: "skipped",
      reason: "booking_disabled",
      metadata: {
        wwex_booking_status: "skipped",
        wwex_booking_reason: "booking_disabled",
      },
    }
  }

  const client = createWwexSpeedshipClientFromEnv(process.env, input.logger)
  if (!client) {
    return {
      status: "skipped",
      reason: "client_not_configured",
      metadata: {
        wwex_booking_status: "skipped",
        wwex_booking_reason: "client_not_configured",
      },
    }
  }

  try {
    const metadata = metadataObject(input.order.metadata)
    const booking = await client.bookSmallpack({
      quote: input.quote.quote,
      notificationEmails: firstText(
        metadata.wwex_notification_email,
        process.env.WWEX_NOTIFICATION_EMAIL
      )
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
    })

    let labelStatus: "available" | "not_requested" | "failed" = "not_requested"
    if (envFlag("WWEX_FETCH_LABEL_ON_RELEASE", true)) {
      try {
        await client.downloadSmallpackLabel(booking.productTransactionId)
        labelStatus = "available"
      } catch (error) {
        labelStatus = "failed"
        input.logger?.warn?.(
          `[wwex] label download failed for order ${input.order.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    return {
      status: "booked",
      booking,
      label_status: labelStatus,
      metadata: {
        wwex_booking_status: "booked",
        wwex_booked_at: new Date().toISOString(),
        wwex_tracking_number: booking.trackingNumber || null,
        wwex_label_status: labelStatus,
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    input.logger?.warn?.(
      `[wwex] shipment booking failed for order ${input.order.id}: ${message}`
    )
    return {
      status: "failed",
      reason: message,
      metadata: {
        wwex_booking_status: "failed",
        wwex_booking_failed_at: new Date().toISOString(),
        wwex_booking_error: message,
      },
    }
  }
}

