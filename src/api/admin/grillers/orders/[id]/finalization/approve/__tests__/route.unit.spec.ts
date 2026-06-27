import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../../../lib/ops-alert"

const mockApproveFinalization = jest.fn()

jest.mock("../../../../../../../../lib/catch-weight-finalization", () => ({
  CATCH_WEIGHT_ORDER_FIELDS: ["id", "metadata"],
  appendStaffAudit: jest.fn((metadata) => metadata),
  approveFinalization: (...args: any[]) => mockApproveFinalization(...args),
  invoiceArOrderMetadata: jest.fn(() => ({})),
  isInvoiceOrder: jest.fn(() => false),
  metadataObject: jest.fn((metadata) => metadata || {}),
}))

jest.mock("../../../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

import { POST } from "../route"

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

function makeScope() {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const query = {
    graph: jest.fn(async () => ({
      data: [{ id: "order_123", metadata: {} }],
    })),
  }
  const db = jest.fn()
  const orderModule = {
    updateOrders: jest.fn(async () => undefined),
  }
  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
      if (key === Modules.ORDER) return orderModule
      throw new Error(`Unknown dependency ${key}`)
    },
  }

  return { db, logger, orderModule, query, scope }
}

describe("approve finalization route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when approval fails after the order is loaded", async () => {
    mockApproveFinalization.mockRejectedValueOnce(
      new Error("finalization preview is stale")
    )
    const { logger, scope } = makeScope()
    const req = {
      auth_context: { actor_id: "user_123" },
      body: { staff_actor_customer_id: "cust_staff" },
      params: { id: "order_123" },
      scope,
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({
      message: "finalization preview is stale",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_route_failed",
        severity: "page",
        title: "Catch-weight finalization route failed: approve_finalization",
        path: "src/api/admin/grillers/orders/[id]/finalization/approve/route.ts",
        logger,
        meta: expect.objectContaining({
          action: "approve_finalization",
          order_id: "order_123",
          route_status: 409,
          error_message: "finalization preview is stale",
        }),
      })
    )
  })
})
