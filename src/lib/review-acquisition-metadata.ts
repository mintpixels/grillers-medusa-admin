export const REVIEW_DELIVERED_AT_METADATA_KEY = "delivered_at"
export const REVIEW_ORDER_COUNT_METADATA_KEY =
  "order_count_at_time_of_purchase"
export const REVIEW_METADATA_RECORDED_AT_KEY =
  "review_delivery_metadata_recorded_at"

export type ReviewAcquisitionMetadata = Record<string, unknown> & {
  delivered_at?: unknown
  order_count_at_time_of_purchase?: unknown
  review_delivery_metadata_recorded_at?: unknown
}

export type OrderForReviewAcquisitionMetadata = {
  id: string
  created_at?: string | Date | null
  metadata?: ReviewAcquisitionMetadata | null
}

function toIsoString(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value)
  const timestamp = date.getTime()
  return Number.isFinite(timestamp) ? date.toISOString() : null
}

export function normalizeReviewTimestamp(
  value: string | Date | null | undefined
): string | null {
  if (!value) return null
  return toIsoString(value)
}

export function countOrdersAtPurchase(
  orders: Array<{ id?: string; created_at?: string | Date | null }>,
  order: OrderForReviewAcquisitionMetadata
): number {
  const orderCreatedAt = order.created_at
    ? new Date(order.created_at).getTime()
    : Number.NaN
  if (!Number.isFinite(orderCreatedAt)) return 1

  const count = orders.filter((candidate) => {
    if (!candidate.created_at) return false
    const candidateCreatedAt = new Date(candidate.created_at).getTime()
    return (
      Number.isFinite(candidateCreatedAt) &&
      candidateCreatedAt <= orderCreatedAt
    )
  }).length

  return Math.max(1, count)
}

export function mergeReviewDeliveryMetadata({
  order,
  deliveredAt,
  orderCount,
  recordedAt = new Date(),
}: {
  order: OrderForReviewAcquisitionMetadata
  deliveredAt: string | Date
  orderCount: number
  recordedAt?: string | Date
}): ReviewAcquisitionMetadata | null {
  const deliveredAtIso = normalizeReviewTimestamp(deliveredAt)
  const recordedAtIso = normalizeReviewTimestamp(recordedAt)
  if (!deliveredAtIso || !recordedAtIso) return null

  const current = order.metadata || {}
  const currentDeliveredAt = normalizeReviewTimestamp(
    current[REVIEW_DELIVERED_AT_METADATA_KEY] as string | Date | undefined
  )
  const currentOrderCount = Number(
    current[REVIEW_ORDER_COUNT_METADATA_KEY]
  )

  const next: ReviewAcquisitionMetadata = { ...current }
  let changed = false

  if (!currentDeliveredAt) {
    next[REVIEW_DELIVERED_AT_METADATA_KEY] = deliveredAtIso
    changed = true
  }

  if (!Number.isFinite(currentOrderCount) || currentOrderCount < 1) {
    next[REVIEW_ORDER_COUNT_METADATA_KEY] = Math.max(1, Math.floor(orderCount))
    changed = true
  }

  if (changed) {
    next[REVIEW_METADATA_RECORDED_AT_KEY] = recordedAtIso
    return next
  }

  return null
}
