import { POST } from "../route"
import { emitOpsAlert } from "../../../../../../../../lib/ops-alert"

jest.mock("../../../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
  return res
}

function makeReq() {
  return {
    params: { id: "sync_123" },
    body: { reason: "retry_from_staff" },
    auth_context: { actor_id: "user_ops" },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") {
          return { warn: jest.fn(), error: jest.fn() }
        }
        return undefined
      },
    },
  } as any
}

describe("QuickBooks sync requeue route alerting", () => {
  const previousUrl = process.env.QB_SYNC_STATUS_URL
  const previousToken = process.env.QB_SYNC_STATUS_TOKEN
  const previousImportUrl = process.env.QB_SYNC_ORDER_IMPORT_URL
  const previousImportToken = process.env.QB_SYNC_ORDER_IMPORT_TOKEN
  const previousFetch = global.fetch

  beforeEach(() => {
    process.env.QB_SYNC_STATUS_URL = "https://sync.example.test"
    process.env.QB_SYNC_STATUS_TOKEN = "sync-token"
    delete process.env.QB_SYNC_ORDER_IMPORT_URL
    delete process.env.QB_SYNC_ORDER_IMPORT_TOKEN
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  afterEach(() => {
    process.env.QB_SYNC_STATUS_URL = previousUrl
    process.env.QB_SYNC_STATUS_TOKEN = previousToken
    process.env.QB_SYNC_ORDER_IMPORT_URL = previousImportUrl
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = previousImportToken
    global.fetch = previousFetch
  })

  it("emits a page alert when the sync service fails a requeue", async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: "sync db unavailable" }), {
          status: 500,
        })
    ) as any

    const res = makeRes()
    await POST(makeReq(), res)

    expect(res.statusCode).toBe(500)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_sync_dashboard_failed",
        severity: "page",
        fingerprint: "qbd_sync_dashboard:requeue:upstream_error:500",
        meta: expect.objectContaining({
          operation: "requeue",
          reason: "upstream_error",
          status: 500,
          sync_queue_id: "sync_123",
          sync_host: "sync.example.test",
          error_message: "{\"error\":\"sync db unavailable\"}",
        }),
      })
    )
  })

  it("emits only a warn alert for upstream requeue business conflicts", async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: "cannot requeue posted order" }), {
          status: 409,
        })
    ) as any

    const res = makeRes()
    await POST(makeReq(), res)

    expect(res.statusCode).toBe(409)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_sync_dashboard_failed",
        severity: "warn",
        fingerprint: "qbd_sync_dashboard:requeue:upstream_error:409",
      })
    )
  })

  it("emits a page alert when the sync service cannot be reached for requeue", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("connect timeout")
    }) as any

    const res = makeRes()
    await POST(makeReq(), res)

    expect(res.statusCode).toBe(502)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_sync_dashboard_failed",
        severity: "page",
        fingerprint: "qbd_sync_dashboard:requeue:unreachable:network",
        meta: expect.objectContaining({
          operation: "requeue",
          reason: "unreachable",
          sync_queue_id: "sync_123",
          error_message: "connect timeout",
        }),
      })
    )
  })
})
