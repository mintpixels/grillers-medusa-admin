import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

jest.mock("../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

import { GET } from "../route"

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

describe("finalization queue route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("alerts without copying raw staff search text when the queue cannot load", async () => {
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const db = jest.fn(() => ({
      select: jest.fn(() => {
        throw new Error("database connection unavailable")
      }),
    }))
    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unknown dependency ${key}`)
      },
    }
    const req = {
      query: {
        q: "avi@example.com #123",
        status: "packing,packed_pending_charge",
        fulfillment_type: "ups_shipping",
        date_from: "2026-06-28",
        limit: "100",
      },
      scope,
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not load finalization queue.",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_queue_failed",
        severity: "page",
        title: "Catch-weight finalization queue failed",
        path: "src/api/admin/grillers/finalization/queue/route.ts",
        logger,
        meta: expect.objectContaining({
          statuses: ["packing", "packed_pending_charge"],
          status_count: 2,
          limit: 100,
          scan_limit: true,
          has_query_text: true,
          has_fulfillment_type: true,
          has_date_from: true,
          has_date_to: false,
          error_message: "database connection unavailable",
        }),
      })
    )
    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(JSON.stringify(meta)).not.toContain("avi@example.com")
    expect(JSON.stringify(meta)).not.toContain("#123")
  })

  it("alerts when visible finalization orders have stale pending QBD postings", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-28T12:00:00.000Z"))

    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const rows = [
      {
        id: "fin_123",
        order_id: "order_123",
        display_id: 1001,
        customer_email: "customer@example.com",
        status: "packed_pending_charge",
        created_at: "2026-06-28T08:00:00.000Z",
      },
    ]
    const builder: Record<string, jest.Mock> = {}
    builder.select = jest.fn(() => builder)
    builder.whereNull = jest.fn(() => builder)
    builder.whereIn = jest.fn(() => builder)
    builder.orderByRaw = jest.fn(() => builder)
    builder.orderBy = jest.fn(() => builder)
    builder.limit = jest.fn(async () => rows)
    const db = jest.fn(() => builder)
    const query = {
      graph: jest.fn(async () => ({
        data: [
          {
            id: "order_123",
            display_id: 1001,
            email: "customer@example.com",
            metadata: {
              qbd_posting_required: true,
              qbd_posting_status: "pending_manual",
              qbd_posting_action: "final_card_charge_accounting_record",
              qbd_posting_request_key: "final_charge:pi_123",
              qbd_posting_requested_at: "2026-06-28T08:00:00.000Z",
            },
          },
        ],
      })),
    }
    const scope = {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unknown dependency ${key}`)
      },
    }
    const req = { query: {}, scope } as any
    const res = makeRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_stale",
        severity: "warn",
        fingerprint: "qbd:pending_posting_stale",
        logger,
        meta: expect.objectContaining({
          stale_after_minutes: 120,
          stale_order_count: 1,
          oldest_age_minutes: 240,
        }),
      })
    )
    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(JSON.stringify(meta)).not.toContain("customer@example.com")
  })
})
