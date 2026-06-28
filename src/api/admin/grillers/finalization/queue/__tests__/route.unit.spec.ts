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
})
