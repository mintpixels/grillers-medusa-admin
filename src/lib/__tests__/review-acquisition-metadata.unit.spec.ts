import {
  countOrdersAtPurchase,
  mergeReviewDeliveryMetadata,
} from "../review-acquisition-metadata"

describe("review acquisition metadata", () => {
  it("adds delivered_at and order count without dropping existing metadata", () => {
    const metadata = mergeReviewDeliveryMetadata({
      order: {
        id: "order_1",
        created_at: "2026-05-01T12:00:00.000Z",
        metadata: { fulfillmentType: "local_delivery" },
      },
      deliveredAt: "2026-05-03T12:00:00.000Z",
      orderCount: 2,
      recordedAt: "2026-05-03T12:05:00.000Z",
    })

    expect(metadata).toEqual({
      fulfillmentType: "local_delivery",
      delivered_at: "2026-05-03T12:00:00.000Z",
      order_count_at_time_of_purchase: 2,
      review_delivery_metadata_recorded_at: "2026-05-03T12:05:00.000Z",
    })
  })

  it("does not overwrite already-recorded review delivery metadata", () => {
    const metadata = mergeReviewDeliveryMetadata({
      order: {
        id: "order_1",
        created_at: "2026-05-01T12:00:00.000Z",
        metadata: {
          delivered_at: "2026-05-02T12:00:00.000Z",
          order_count_at_time_of_purchase: 1,
        },
      },
      deliveredAt: "2026-05-03T12:00:00.000Z",
      orderCount: 3,
      recordedAt: "2026-05-03T12:05:00.000Z",
    })

    expect(metadata).toBeNull()
  })

  it("counts orders placed at or before the current order", () => {
    const count = countOrdersAtPurchase(
      [
        { id: "older", created_at: "2026-04-01T12:00:00.000Z" },
        { id: "current", created_at: "2026-05-01T12:00:00.000Z" },
        { id: "newer", created_at: "2026-05-10T12:00:00.000Z" },
      ],
      { id: "current", created_at: "2026-05-01T12:00:00.000Z" }
    )

    expect(count).toBe(2)
  })
})
