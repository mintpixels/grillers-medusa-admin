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

function makeReq(input: { query?: Record<string, unknown>; db: any }) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  const req = {
    query: input.query || {},
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return input.db
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any

  return { logger, req }
}

function makeBuilder(result: unknown[] | Error, calls: Record<string, unknown>) {
  const builder: any = {
    select: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn((value) => {
      calls.limit = value
      return builder
    }),
    offset: jest.fn((value) => {
      calls.offset = value
      return builder
    }),
    whereIn: jest.fn((column, values) => {
      calls.whereIn = { column, values }
      return builder
    }),
    where: jest.fn((column, value) => {
      calls.where = { column, value }
      return builder
    }),
    andWhere: jest.fn((callback) => {
      calls.andWhere = true
      callback(builder)
      return builder
    }),
    whereILike: jest.fn(() => builder),
    orWhereILike: jest.fn(() => builder),
    then: jest.fn((resolve, reject) => {
      if (result instanceof Error) {
        reject(result)
        return
      }
      resolve(result)
    }),
  }
  return builder
}

describe("admin inventory allocation list route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts with redacted metadata when allocation listing fails", async () => {
    const calls: Record<string, unknown> = {}
    const db = jest.fn(() =>
      makeBuilder(
        new Error("allocation read failed for customer@example.com order_123"),
        calls
      )
    )
    const { logger, req } = makeReq({
      db,
      query: {
        limit: "200",
        offset: "bad",
        status: "active",
        variant_id: "variant_123",
        order_id: "order_123",
        q: "customer@example.com",
      },
    })
    const res = makeRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message: "Could not load inventory allocations.",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "inventory_allocation_list_failed",
        severity: "page",
        title: "Inventory allocation list failed",
        path: "src/api/admin/grillers/inventory/allocations/route.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          route_status: 500,
          limit: 100,
          offset: 0,
          status: "active",
          has_variant_id: true,
          has_order_id: true,
          has_search: true,
          error_message:
            "allocation read failed for [redacted-email] [redacted-id]",
        }),
      })
    )
    const alertJson = JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0])
    expect(alertJson).not.toContain("customer@example.com")
    expect(alertJson).not.toContain("order_123")
    expect(calls.limit).toBe(100)
    expect(calls.offset).toBe(0)
  })

  it("normalizes invalid pagination instead of passing NaN to the query", async () => {
    const rows = [{ id: "alloc_123", status: "reserved" }]
    const calls: Record<string, unknown> = {}
    const db = jest.fn(() => makeBuilder(rows, calls))
    const { req } = makeReq({
      db,
      query: { limit: "not-a-number", offset: "-7" },
    })
    const res = makeRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      allocations: rows,
      limit: 50,
      offset: 0,
    })
    expect(calls.limit).toBe(50)
    expect(calls.offset).toBe(0)
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })
})
