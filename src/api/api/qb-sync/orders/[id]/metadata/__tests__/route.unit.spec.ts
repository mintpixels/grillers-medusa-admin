import { Modules } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../../lib/ops-alert"
import { POST } from "../route"

jest.mock("../../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("QuickBooks sync order metadata callback", () => {
  const previousToken = process.env.QB_SYNC_ORDER_IMPORT_TOKEN

  beforeEach(() => {
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  afterEach(() => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = previousToken
  })

  it("merges QBD writer metadata with the existing order metadata", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: { existing: true },
      })),
      updateOrders: jest.fn(async () => undefined),
    }
    const req = {
      params: { id: "order_123" },
      body: {
        metadata: {
          qbd_posting_required: false,
          qbd_posting_status: "posted",
          qbd_write_job_id: 42,
        },
      },
      headers: {
        "x-qb-sync-token": "sync-token",
      },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          throw new Error(`Unknown dependency ${key}`)
        },
      },
    } as any
    const res = {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(orderModule.updateOrders).toHaveBeenCalledWith("order_123", {
      metadata: {
        existing: true,
        qbd_posting_required: false,
        qbd_posting_status: "posted",
        qbd_write_job_id: 42,
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("rejects callbacks without the shared sync token", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    const req = {
      params: { id: "order_123" },
      body: { metadata: { qbd_posting_status: "posted" } },
      headers: {},
      scope: { resolve: jest.fn() },
    } as any
    const res = {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("pages when the shared sync token is not configured", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = ""
    const req = {
      params: { id: "order_123" },
      body: { metadata: { qbd_posting_status: "posted" } },
      headers: { "x-qb-sync-token": "sync-token" },
      scope: { resolve: jest.fn() },
    } as any
    const res = {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_order_metadata_update_failed",
        severity: "page",
        fingerprint: "qbd_order_metadata_update:configuration",
        meta: expect.objectContaining({
          reason: "configuration",
          has_order_id: true,
          order_id: "order_123",
        }),
      })
    )
  })

  it("pages and redacts when order metadata cannot be persisted", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: { existing: true },
      })),
      updateOrders: jest.fn(async () => {
        throw new Error("database down for shopper@example.com order_123")
      }),
    }
    const req = {
      params: { id: "order_123" },
      body: {
        metadata: {
          qbd_posting_required: false,
          qbd_posting_status: "posted",
        },
      },
      headers: {
        "x-qb-sync-token": "sync-token",
      },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          throw new Error(`Unknown dependency ${key}`)
        },
      },
    } as any
    const res = {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_order_metadata_update_failed",
        severity: "page",
        fingerprint: "qbd_order_metadata_update:metadata_persist",
        meta: expect.objectContaining({
          reason: "metadata_persist",
          has_order_id: true,
          order_id: "order_123",
          error_message: expect.stringContaining("[redacted-email]"),
        }),
      })
    )
    const alertJson = JSON.stringify((emitOpsAlert as jest.Mock).mock.calls)
    expect(alertJson).not.toContain("shopper@example.com")
  })
})
