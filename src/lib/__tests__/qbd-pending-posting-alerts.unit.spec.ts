import {
  buildStaleQbdPostingAlert,
  emitStaleQbdPostingAlertForOrders,
} from "../qbd-pending-posting-alerts"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("QBD pending posting alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not alert for recent or already posted QBD metadata", () => {
    const alert = buildStaleQbdPostingAlert({
      now: new Date("2026-06-28T12:00:00.000Z"),
      staleAfterMinutes: 120,
      orders: [
        {
          id: "order_recent",
          metadata: {
            qbd_posting_required: true,
            qbd_posting_status: "pending_manual",
            qbd_posting_requested_at: "2026-06-28T11:30:00.000Z",
          },
        },
        {
          id: "order_posted",
          metadata: {
            qbd_posting_required: false,
            qbd_posting_status: "posted",
            qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
          },
        },
      ],
    })

    expect(alert).toBeNull()
  })

  it("builds a redacted stale pending-posting alert", () => {
    const alert = buildStaleQbdPostingAlert({
      now: new Date("2026-06-28T12:00:00.000Z"),
      staleAfterMinutes: 120,
      orders: [
        {
          id: "order_123",
          display_id: 1001,
          metadata: {
            qbd_posting_required: true,
            qbd_posting_status: "pending_manual",
            qbd_posting_action: "final_card_charge_accounting_record",
            qbd_posting_request_key: "final_charge:pi_123",
            qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
            email: "customer@example.com",
          },
        },
      ],
    })

    expect(alert).toEqual(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_stale",
        severity: "warn",
        fingerprint: "qbd:pending_posting_stale",
        meta: expect.objectContaining({
          stale_after_minutes: 120,
          stale_order_count: 1,
          oldest_age_minutes: 240,
          stale_orders: [
            expect.objectContaining({
              order_id: "order_123",
              display_id: "1001",
              qbd_posting_status: "pending_manual",
              qbd_posting_action: "final_card_charge_accounting_record",
              qbd_posting_request_key: "final_charge:pi_123",
              age_minutes: 240,
            }),
          ],
        }),
      })
    )
    expect(JSON.stringify(alert)).not.toContain("customer@example.com")
  })

  it("emits the stale pending-posting alert", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }

    await emitStaleQbdPostingAlertForOrders({
      logger,
      now: new Date("2026-06-28T12:00:00.000Z"),
      staleAfterMinutes: 120,
      path: "test/path.ts",
      orders: [
        {
          id: "order_123",
          metadata: {
            qbd_posting_required: true,
            qbd_posting_status: "pending_manual",
            qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
          },
        },
      ],
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_stale",
        severity: "warn",
        path: "test/path.ts",
        source: "medusa-server",
        fingerprint: "qbd:pending_posting_stale",
        logger,
      })
    )
  })
})
