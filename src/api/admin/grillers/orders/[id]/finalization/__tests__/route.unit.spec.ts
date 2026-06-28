import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../../lib/ops-alert"

const mockPreviewFinalization = jest.fn()

jest.mock("../../../../../../../lib/catch-weight-finalization", () => ({
  CATCH_WEIGHT_ORDER_FIELDS: ["id", "metadata"],
  previewFinalization: (...args: any[]) => mockPreviewFinalization(...args),
}))

jest.mock("../../../../../../../lib/ops-alert", () => ({
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

function makeScope() {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const query = {
    graph: jest.fn(async () => ({
      data: [{ id: "order_123", metadata: {} }],
    })),
  }
  const db = jest.fn()
  const scope = {
    resolve: (key: string) => {
      if (key === ContainerRegistrationKeys.QUERY) return query
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
      throw new Error(`Unknown dependency ${key}`)
    },
  }

  return { db, logger, query, scope }
}

describe("finalization detail route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when the finalization detail cannot be loaded", async () => {
    mockPreviewFinalization.mockRejectedValueOnce(
      new Error("finalization preview load failed")
    )
    const { logger, scope } = makeScope()
    const req = {
      auth_context: { actor_id: "user_123" },
      params: { id: "order_123" },
      scope,
    } as any
    const res = makeRes()

    await GET(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not load finalization.",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_route_failed",
        severity: "page",
        title:
          "Catch-weight finalization route failed: load_finalization_detail",
        path: "src/api/admin/grillers/orders/[id]/finalization/route.ts",
        logger,
        meta: expect.objectContaining({
          action: "load_finalization_detail",
          order_id: "order_123",
          route_status: 500,
          error_message: "finalization preview load failed",
        }),
      })
    )
  })
})
