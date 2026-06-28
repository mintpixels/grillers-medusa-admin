import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../../../lib/ops-alert"

const mockUpdateFinalizationPackages = jest.fn()
const mockPreviewFinalization = jest.fn()

jest.mock("../../../../../../../../lib/catch-weight-finalization", () => ({
  CATCH_WEIGHT_ORDER_FIELDS: ["id", "metadata"],
  FINALIZATION_PACKED_PENDING_REVIEW: "packed_pending_review",
  appendStaffAudit: jest.fn((metadata) => metadata),
  metadataObject: jest.fn((metadata) => metadata || {}),
  previewFinalization: (...args: any[]) => mockPreviewFinalization(...args),
  updateFinalizationPackages: (...args: any[]) =>
    mockUpdateFinalizationPackages(...args),
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

function makeScope(
  overrides: {
    queryGraph?: jest.Mock
  } = {}
) {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const query = {
    graph: overrides.queryGraph || jest.fn(async () => ({
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

  return { logger, scope }
}

describe("packages finalization route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPreviewFinalization.mockResolvedValue({
      charge_attempts: [],
      errors: [],
      finalization: { id: "fin_123", status: "packed_pending_review" },
      lines: [],
      package_capture_required: false,
      packages: [],
      payment_setup: null,
      totals: {},
      warnings: [],
    })
  })

  it("alerts when package capture fails after the order is loaded", async () => {
    mockUpdateFinalizationPackages.mockRejectedValueOnce(
      new Error("box weight is invalid")
    )
    const { logger, scope } = makeScope()
    const req = {
      auth_context: { actor_id: "user_123" },
      body: {
        packages: [{ package_type: "box", packed_weight_lb: "abc" }],
      },
      params: { id: "order_123" },
      scope,
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      message: "box weight is invalid",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_route_failed",
        severity: "page",
        title: "Catch-weight finalization route failed: update_packages",
        path: "src/api/admin/grillers/orders/[id]/finalization/packages/route.ts",
        logger,
        meta: expect.objectContaining({
          action: "update_packages",
          order_id: "order_123",
          route_status: 400,
          error_message: "box weight is invalid",
        }),
      })
    )
  })

  it("alerts when package capture cannot load the order", async () => {
    const queryGraph = jest.fn(async () => {
      throw new Error("order lookup failed for order_123 and avi@example.com")
    })
    const { logger, scope } = makeScope({ queryGraph })
    const req = {
      auth_context: { actor_id: "user_123" },
      body: {
        packages: [{ package_type: "box", packed_weight_lb: "10" }],
      },
      params: { id: "order_123" },
      scope,
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(mockUpdateFinalizationPackages).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not load finalization order.",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_route_failed",
        severity: "page",
        title: "Catch-weight finalization route failed: update_packages",
        path: "src/api/admin/grillers/orders/[id]/finalization/packages/route.ts",
        logger,
        meta: expect.objectContaining({
          action: "update_packages",
          order_id: "order_123",
          route_status: 500,
          error_message:
            "order lookup failed for [redacted-id] and [redacted-email]",
        }),
      })
    )
  })
})
