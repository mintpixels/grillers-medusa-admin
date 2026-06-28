const mockEmitOpsAlert = jest.fn(async (_input: any) => ({
  ok: true,
  skipped: false,
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: (input: any) => mockEmitOpsAlert(input),
}))

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import reviewAcquisitionDeliveryMetadataHandler from "../../subscribers/review-acquisition-delivery-metadata"

function makeContainer(query: { graph: jest.Mock }) {
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
  const orderModule = {
    listAndCountOrders: jest.fn(async () => [[], 1]),
    updateOrders: jest.fn(async () => undefined),
  }
  const db = jest.fn(() => ({
    whereNull: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    count: jest.fn(async () => [{ count: 0 }]),
  }))
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      if (key === "query") return query
      if (key === Modules.ORDER) return orderModule
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
      throw new Error(`Unexpected dependency ${key}`)
    }),
  }

  return { container, logger, orderModule, db }
}

async function run(container: any, fulfillmentId = "ful_123") {
  await reviewAcquisitionDeliveryMetadataHandler({
    event: { data: { id: fulfillmentId } },
    container,
  } as any)
}

describe("review acquisition delivery metadata alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when no fulfillment delivery can be loaded", async () => {
    const query = { graph: jest.fn().mockResolvedValueOnce({ data: [] }) }
    const { container, logger, orderModule } = makeContainer(query)

    await run(container)

    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "review_acquisition_delivery_metadata_failed",
        severity: "warn",
        path: "src/subscribers/review-acquisition-delivery-metadata.ts",
        meta: expect.objectContaining({
          reason: "no_fulfillment_delivery",
          fulfillment_id: "ful_123",
          order_id: null,
        }),
        logger,
      })
    )
  })

  it("alerts when a fulfillment cannot be mapped back to an order", async () => {
    const query = {
      graph: jest
        .fn()
        .mockResolvedValueOnce({
          data: [{ id: "ful_123", delivered_at: "2026-06-01T12:00:00.000Z" }],
        })
        .mockResolvedValueOnce({ data: [] }),
    }
    const { container } = makeContainer(query)

    await run(container)

    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "review_acquisition_delivery_metadata_failed",
        meta: expect.objectContaining({
          reason: "order_id_not_resolved",
          fulfillment_id: "ful_123",
        }),
      })
    )
  })

  it("alerts when the handler throws unexpectedly", async () => {
    const error = new Error("query failed")
    const query = { graph: jest.fn().mockRejectedValueOnce(error) }
    const { container, logger } = makeContainer(query)

    await run(container)

    expect(logger.error).toHaveBeenCalledWith(
      "[review-acquisition-delivery-metadata] failed for fulfillment ful_123: query failed"
    )
    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "review_acquisition_delivery_metadata_failed",
        meta: expect.objectContaining({
          reason: "handler_failed",
          fulfillment_id: "ful_123",
          error_message: "query failed",
        }),
      })
    )
  })
})
