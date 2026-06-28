import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { checkInventoryAvailability } from "../../../../../lib/inventory-allocation"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/inventory-allocation", () => ({
  checkInventoryAvailability: jest.fn(),
}))

jest.mock("../../../../../lib/ops-alert", () => ({
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

function makeReq(body: Record<string, unknown>) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  const req = {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return {}
        if (key === ContainerRegistrationKeys.QUERY) return {}
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any

  return { logger, req }
}

describe("store inventory availability route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when customer availability checks fail after validation", async () => {
    ;(checkInventoryAvailability as jest.Mock).mockRejectedValueOnce(
      new Error("ATP query failed for variant_123 and shopper@example.com")
    )
    const { logger, req } = makeReq({
      cart_id: "cart_123",
      fulfillment_type: "ups_shipping",
      requested_fulfillment_date: "2026-07-02",
      lines: [
        {
          product_id: "prod_123",
          variant_id: "variant_123",
          quantity: 2,
          sku: "10-11-01",
        },
      ],
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      message: "Could not check inventory availability.",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "inventory_availability_route_failed",
        severity: "page",
        title: "Inventory availability check failed: store",
        path: "src/api/store/gp-inventory/availability/route.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          surface: "store",
          availability_source: "customer_web",
          route_status: 500,
          line_count: 1,
          has_cart_id: true,
          has_order_id: false,
          has_customer_id: false,
          has_fulfillment_type: true,
          has_requested_fulfillment_date: true,
          include_internal: false,
          record_snapshots: true,
          error_message:
            "ATP query failed for [redacted-id] and [redacted-email]",
        }),
      })
    )
  })
})
