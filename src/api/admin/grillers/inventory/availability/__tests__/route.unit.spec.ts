import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { checkInventoryAvailability } from "../../../../../../lib/inventory-allocation"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

jest.mock("../../../../../../lib/inventory-allocation", () => ({
  checkInventoryAvailability: jest.fn(),
}))

jest.mock("../../../../../../lib/ops-alert", () => ({
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

describe("admin inventory availability route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when staff availability checks fail after validation", async () => {
    ;(checkInventoryAvailability as jest.Mock).mockRejectedValueOnce(
      new Error("ATP query failed for order_123 and variant_123")
    )
    const { logger, req } = makeReq({
      cart_id: "cart_123",
      order_id: "order_123",
      customer_id: "cus_123",
      source: "staff_phone_order",
      fulfillment_type: "plant_pickup",
      requested_fulfillment_date: "2026-07-03",
      lines: [
        {
          product_id: "prod_123",
          variant_id: "variant_123",
          quantity: 4,
          qbd_list_id: "80000ABC-123",
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
        title: "Inventory availability check failed: admin",
        path: "src/api/admin/grillers/inventory/availability/route.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          surface: "admin",
          availability_source: "staff_phone_order",
          route_status: 500,
          line_count: 1,
          has_cart_id: true,
          has_order_id: true,
          has_customer_id: true,
          has_fulfillment_type: true,
          has_requested_fulfillment_date: true,
          include_internal: true,
          record_snapshots: true,
          error_message: "ATP query failed for [redacted-id] and [redacted-id]",
        }),
      })
    )
  })
})
