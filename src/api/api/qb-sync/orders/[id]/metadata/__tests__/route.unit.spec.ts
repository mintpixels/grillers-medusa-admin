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

  it("authenticates when the stored token has a stray trailing newline", async () => {
    // Regression: the secret was stored via the CLI with a trailing "\n" (65 bytes).
    // HTTP strips trailing whitespace from header values, so the caller sends the
    // clean 64-byte value; without trimming, secureCompare length-mismatches => 401.
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token\n"
    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: { existing: true },
      })),
      updateOrders: jest.fn(async () => undefined),
    }
    const req = {
      params: { id: "order_123" },
      body: { metadata: { qbd_posting_status: "posted" } },
      headers: { "x-qb-sync-token": "sync-token" },
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

    expect(res.status).toHaveBeenCalledWith(200)
    expect(orderModule.updateOrders).toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("accepts QBD posting metadata when the request key matches the current order key", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: {
          qbd_posting_status: "pending_manual",
          qbd_posting_request_key: "final_charge:pi_123",
        },
      })),
      updateOrders: jest.fn(async () => undefined),
    }
    const req = {
      params: { id: "order_123" },
      body: {
        metadata: {
          qbd_posting_required: false,
          qbd_posting_status: "posted",
          qbd_posting_request_key: "final_charge:pi_123",
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
      metadata: expect.objectContaining({
        qbd_posting_required: false,
        qbd_posting_status: "posted",
        qbd_posting_request_key: "final_charge:pi_123",
      }),
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("rejects stale QBD posting callbacks when the request key does not match", async () => {
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: {
          qbd_posting_status: "pending_manual",
          qbd_posting_request_key: "final_charge:pi_current",
        },
      })),
      updateOrders: jest.fn(async () => undefined),
    }
    const req = {
      params: { id: "order_123" },
      body: {
        metadata: {
          qbd_posting_required: false,
          qbd_posting_status: "posted",
          qbd_posting_request_key: "refund:re_stale",
          qbd_write_job_id: 99,
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

    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      error: "QuickBooks metadata request key mismatch",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_order_metadata_update_failed",
        severity: "warn",
        fingerprint: "qbd_order_metadata_update:request_key_mismatch",
        meta: expect.objectContaining({
          reason: "request_key_mismatch",
          has_existing_request_key: true,
          has_incoming_request_key: true,
          existing_posting_status: "pending_manual",
          incoming_posting_status: "posted",
        }),
      })
    )
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

  it("pages (503, not a silent 401) when the secret is whitespace-only", async () => {
    // A blank-after-trim secret must surface as a loud configuration page here,
    // not trim to "" inside authorized() and silently 401 every callback.
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "\n"
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
