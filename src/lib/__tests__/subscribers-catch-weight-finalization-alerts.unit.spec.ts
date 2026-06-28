import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ensureFinalizationForOrder } from "../catch-weight-finalization"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../catch-weight-finalization", () => ({
  CATCH_WEIGHT_ORDER_FIELDS: ["id", "metadata"],
  ensureFinalizationForOrder: jest.fn(),
  orderPlacedFinalizationMetadata: jest.fn(() => ({
    catch_weight_status: "pending_pick",
  })),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const catchWeightFinalizationOrderPlacedHandler =
  require("../../subscribers/catch-weight-finalization-order-placed").default

function makeContainer({
  orders = [{ id: "order_123", metadata: {} }],
}: {
  orders?: Array<Record<string, any>>
} = {}) {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  const db = jest.fn()
  const query = {
    graph: jest.fn(async () => ({ data: orders })),
  }
  const orderModule = {
    updateOrders: jest.fn(async () => undefined),
  }

  return {
    db,
    logger,
    orderModule,
    query,
    container: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER || key === "logger") {
          return logger
        }
        if (key === ContainerRegistrationKeys.QUERY) return query
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        if (key === Modules.ORDER) return orderModule
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  }
}

describe("catch-weight finalization subscriber alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(ensureFinalizationForOrder as jest.Mock).mockResolvedValue({
      finalization: { id: "fin_123", status: "pending_pick" },
      lines: [],
    })
  })

  it("alerts when order.placed does not include an order id", async () => {
    const { container, logger, query } = makeContainer()

    await catchWeightFinalizationOrderPlacedHandler({
      event: { data: {} },
      container,
    })

    expect(query.graph).not.toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_skipped",
        severity: "page",
        title:
          "Catch-weight finalization initialization skipped because order id is missing",
        path: "src/subscribers/catch-weight-finalization-order-placed.ts",
        logger,
        meta: expect.objectContaining({
          action: "order_placed_finalization_init",
          source_event: "order.placed",
          order_id: null,
        }),
      })
    )
  })

  it("alerts when the placed order cannot be loaded", async () => {
    const { container, logger } = makeContainer({ orders: [] })

    await catchWeightFinalizationOrderPlacedHandler({
      event: { data: { id: "order_missing" } },
      container,
    })

    expect(logger.warn).toHaveBeenCalledWith(
      "[catch-weight-finalization] order not found id=order_missing"
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_skipped",
        severity: "page",
        title:
          "Catch-weight finalization initialization skipped because order was not found",
        meta: expect.objectContaining({
          order_id: "order_missing",
          error_message: null,
        }),
      })
    )
  })

  it("alerts when initialization throws", async () => {
    ;(ensureFinalizationForOrder as jest.Mock).mockRejectedValueOnce(
      new Error("finalization insert failed")
    )
    const { container, logger } = makeContainer()

    await catchWeightFinalizationOrderPlacedHandler({
      event: { data: { id: "order_123" } },
      container,
    })

    expect(logger.error).toHaveBeenCalledWith(
      "[catch-weight-finalization] failed to initialize order=order_123: finalization insert failed"
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "catch_weight_finalization_failed",
        severity: "page",
        title: "Catch-weight finalization initialization failed",
        meta: expect.objectContaining({
          order_id: "order_123",
          error_message: "finalization insert failed",
        }),
      })
    )
  })
})
