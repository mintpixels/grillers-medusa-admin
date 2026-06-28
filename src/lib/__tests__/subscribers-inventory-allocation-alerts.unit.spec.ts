import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createAllocationsForOrder,
  fulfillAllocationsForFulfillment,
  releaseAllocationsForOrder,
} from "../inventory-allocation"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../inventory-allocation", () => ({
  createAllocationsForOrder: jest.fn(),
  releaseAllocationsForOrder: jest.fn(),
  fulfillAllocationsForFulfillment: jest.fn(),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const orderPlacedHandler =
  require("../../subscribers/inventory-allocation-order-placed").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const orderCanceledHandler =
  require("../../subscribers/inventory-allocation-order-canceled").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fulfillmentCreatedHandler =
  require("../../subscribers/inventory-allocation-fulfillment-created").default

function makeContainer() {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const db = jest.fn()
  const query = { graph: jest.fn() }
  return {
    logger,
    db,
    query,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        if (key === ContainerRegistrationKeys.QUERY) return query
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  }
}

describe("inventory allocation subscriber failure alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when order placement allocation fails", async () => {
    ;(createAllocationsForOrder as jest.Mock).mockRejectedValueOnce(
      new Error("allocation insert failed")
    )
    const { container, logger } = makeContainer()

    await orderPlacedHandler({
      event: { data: { id: "order_123" } },
      container,
    })

    expect(logger.error).toHaveBeenCalledWith(
      "[inventory-allocation] failed to allocate order=order_123: allocation insert failed"
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "inventory_allocation_subscriber_failed",
        severity: "page",
        title: "Inventory allocation subscriber failed: order_allocate",
        path: "src/subscribers/inventory-allocation-order-placed.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          action: "order_allocate",
          order_id: "order_123",
          fulfillment_id: null,
          error_message: "allocation insert failed",
        }),
      })
    )
  })

  it("alerts when cancellation allocation release fails", async () => {
    ;(releaseAllocationsForOrder as jest.Mock).mockRejectedValueOnce(
      new Error("release failed")
    )
    const { container } = makeContainer()

    await orderCanceledHandler({
      event: { data: { id: "order_cancel", reason: "customer_cancel" } },
      container,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "inventory_allocation_subscriber_failed",
        severity: "page",
        title: "Inventory allocation subscriber failed: order_cancel_release",
        path: "src/subscribers/inventory-allocation-order-canceled.ts",
        meta: expect.objectContaining({
          action: "order_cancel_release",
          order_id: "order_cancel",
          fulfillment_id: null,
          error_message: "release failed",
        }),
      })
    )
  })

  it("alerts when fulfillment allocation completion fails", async () => {
    ;(fulfillAllocationsForFulfillment as jest.Mock).mockRejectedValueOnce(
      new Error("fulfillment lookup failed")
    )
    const { container } = makeContainer()

    await fulfillmentCreatedHandler({
      event: { data: { id: "fulfillment_123" } },
      container,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "inventory_allocation_subscriber_failed",
        severity: "page",
        title: "Inventory allocation subscriber failed: fulfillment_complete",
        path: "src/subscribers/inventory-allocation-fulfillment-created.ts",
        meta: expect.objectContaining({
          action: "fulfillment_complete",
          order_id: null,
          fulfillment_id: "fulfillment_123",
          error_message: "fulfillment lookup failed",
        }),
      })
    )
  })
})
