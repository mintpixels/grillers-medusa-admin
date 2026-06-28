import { GET } from "../status/route"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/ops-alert", () => ({
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

function makeReq(query: Record<string, unknown> = {}) {
  return {
    query,
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

describe("QuickBooks sync status route alerting", () => {
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

  it("emits a warn alert when the sync status upstream returns an error", async () => {
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ error: "sync db unavailable" }), {
          status: 500,
        })
    ) as any

    const res = makeRes()
    await GET(makeReq({ page: "2" }), res)

    expect(res.statusCode).toBe(500)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_sync_dashboard_failed",
        severity: "warn",
        fingerprint: "qbd_sync_dashboard:status:upstream_error:500",
        meta: expect.objectContaining({
          operation: "status",
          reason: "upstream_error",
          status: 500,
          sync_host: "sync.example.test",
          staff_actor_id: "user_ops",
        }),
      })
    )
  })

  it("emits a warn alert when the sync status upstream is unreachable", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("connect ECONNREFUSED")
    }) as any

    const res = makeRes()
    await GET(makeReq(), res)

    expect(res.statusCode).toBe(502)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_sync_dashboard_failed",
        severity: "warn",
        fingerprint: "qbd_sync_dashboard:status:unreachable:network",
        meta: expect.objectContaining({
          operation: "status",
          reason: "unreachable",
          error_message: "connect ECONNREFUSED",
        }),
      })
    )
  })
})
