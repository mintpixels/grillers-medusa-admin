import { emitAnalyticsSubscriberFailureAlert } from "../analytics/subscriber-alerts"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("analytics subscriber alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits a redacted warn alert for subscriber failures before delivery", async () => {
    const logger = {
      warn: jest.fn(),
      error: jest.fn(),
    }

    await emitAnalyticsSubscriberFailureAlert({
      logger: logger as any,
      medusaEvent: "order.placed",
      analyticsEvent: "order_completed",
      entityId: "order_123",
      path: "src/subscribers/analytics/order-placed.ts",
      error: new Error("failed for buyer@example.com"),
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "analytics_subscriber_failed",
        severity: "warn",
        title: "Analytics subscriber failed for order.placed",
        path: "src/subscribers/analytics/order-placed.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          medusa_event: "order.placed",
          analytics_event: "order_completed",
          entity_id: "order_123",
          error: "failed for [redacted-email]",
        }),
      })
    )
  })
})
