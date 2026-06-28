import {
  buildStaleQbdPostingAlert,
  emitStaleQbdPostingAlertFromDb,
  emitStaleQbdPostingAlertForOrders,
  findPendingQbdPostingOrders,
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

  it("finds pending QBD posting candidates from the order table", async () => {
    const builder: Record<string, jest.Mock> = {}
    builder.select = jest.fn(() => builder)
    builder.whereNull = jest.fn(() => builder)
    builder.whereRaw = jest.fn(() => builder)
    builder.orderByRaw = jest.fn(() => builder)
    builder.limit = jest.fn(async () => [
      {
        id: "order_123",
        display_id: 1001,
        metadata: JSON.stringify({
          qbd_posting_required: true,
          qbd_posting_status: "pending_manual",
          qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
        }),
      },
    ])
    const db = jest.fn(() => builder)

    const orders = await findPendingQbdPostingOrders(db, 500)

    expect(db).toHaveBeenCalledWith("order")
    expect(builder.whereNull).toHaveBeenCalledWith("deleted_at")
    expect(builder.limit).toHaveBeenCalledWith(500)
    expect(orders).toEqual([
      {
        id: "order_123",
        display_id: "1001",
        metadata: {
          qbd_posting_required: true,
          qbd_posting_status: "pending_manual",
          qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
        },
      },
    ])
  })

  it("emits stale pending-posting alerts from a DB scan", async () => {
    const builder: Record<string, jest.Mock> = {}
    builder.select = jest.fn(() => builder)
    builder.whereNull = jest.fn(() => builder)
    builder.whereRaw = jest.fn(() => builder)
    builder.orderByRaw = jest.fn(() => builder)
    builder.limit = jest.fn(async () => [
      {
        id: "order_123",
        display_id: 1001,
        metadata: {
          qbd_posting_required: true,
          qbd_posting_status: "pending_manual",
          qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
        },
      },
    ])
    const db = jest.fn(() => builder)

    const result = await emitStaleQbdPostingAlertFromDb({
      db,
      now: new Date("2026-06-28T12:00:00.000Z"),
      staleAfterMinutes: 120,
      limit: 100,
      path: "src/jobs/qbd-pending-posting-monitor.ts",
    })

    expect(result).toEqual({
      emitted: true,
      staleOrderCount: 1,
      candidateCount: 1,
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_stale",
        path: "src/jobs/qbd-pending-posting-monitor.ts",
      })
    )
  })
})
