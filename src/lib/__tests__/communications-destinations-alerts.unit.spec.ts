const mockEmitOpsAlert = jest.fn(async (_input: any) => ({
  ok: true,
  skipped: false,
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: (input: any) => mockEmitOpsAlert(input),
}))

import { writeEventToGa4 } from "../communications/destinations"

const originalEnv = process.env
const originalFetch = global.fetch

function makeDb() {
  const merge = jest.fn(async () => undefined)
  const onConflict = jest.fn(() => ({ merge }))
  const insert = jest.fn(() => ({ onConflict }))
  const db = jest.fn(() => ({ insert })) as any
  db.raw = jest.fn((query: string) => query)

  return { db, insert, onConflict, merge }
}

describe("communications destination delivery alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.GA4_MEASUREMENT_ID = "G-TEST"
    process.env.GA4_API_SECRET = "secret"
    delete process.env.CLICKHOUSE_URL
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it("alerts when a configured destination fails for a high-value communications event", async () => {
    const { db } = makeDb()
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "rejected avi@example.com",
    })) as any

    const delivered = await writeEventToGa4(db, {
      event_id: "evt_123",
      event_name: "order_completed",
      source: "medusa-server",
      profile_id: "gpcprof_123",
      medusa_customer_id: "cus_123",
      order_id: "order_123",
      cart_id: "cart_123",
      campaign_id: "camp_123",
      flow_id: "flow_123",
      template_key: "order-placed",
      message_id: "gpmsg_123",
      email: "avi@example.com",
    })

    expect(delivered).toBe(false)
    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_destination_delivery_failed",
        severity: "warn",
        title: "Communications ga4 delivery failed for order_completed",
        path: "src/lib/communications/destinations.ts",
        source: "medusa-server",
        meta: expect.objectContaining({
          destination: "ga4",
          event_id: "evt_123",
          event_name: "order_completed",
          event_source: "medusa-server",
          order_id: "order_123",
          cart_id: "cart_123",
          campaign_id: "camp_123",
          flow_id: "flow_123",
          template_key: "order-placed",
          message_id: "gpmsg_123",
          has_profile_id: true,
          has_medusa_customer_id: true,
          error: "GA4 500: rejected [redacted-email]",
        }),
      })
    )
    expect(JSON.stringify(mockEmitOpsAlert.mock.calls[0][0].meta)).not.toContain(
      "avi@example.com"
    )
  })

  it("does not alert for low-value destination failures that are already recorded", async () => {
    const { db } = makeDb()
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "temporary ga4 outage",
    })) as any

    const delivered = await writeEventToGa4(db, {
      event_id: "evt_456",
      event_name: "page_viewed",
      source: "storefront",
    })

    expect(delivered).toBe(false)
    expect(mockEmitOpsAlert).not.toHaveBeenCalled()
  })
})
