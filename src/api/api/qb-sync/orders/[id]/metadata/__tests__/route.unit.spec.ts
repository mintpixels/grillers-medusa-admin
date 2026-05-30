import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

describe("QuickBooks sync order metadata callback", () => {
  const previousToken = process.env.QB_SYNC_ORDER_IMPORT_TOKEN

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
  })
})
