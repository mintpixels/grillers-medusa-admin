const mockFetchOrderForEmail = jest.fn()
const mockEmitTransactionalEmailHandlerFailureAlert = jest.fn()
const mockEmitTransactionalEmailPreconditionAlert = jest.fn()
const mockSendTrackedEmail = jest.fn()

jest.mock("../emails/order-fetch", () => ({
  fetchOrderForEmail: (...args: any[]) => mockFetchOrderForEmail(...args),
}))

jest.mock("../emails/ops-alerts", () => ({
  emitTransactionalEmailHandlerFailureAlert: (...args: any[]) =>
    mockEmitTransactionalEmailHandlerFailureAlert(...args),
  emitTransactionalEmailPreconditionAlert: (...args: any[]) =>
    mockEmitTransactionalEmailPreconditionAlert(...args),
}))

jest.mock("../communications/core", () => ({
  sendTrackedEmail: (...args: any[]) => mockSendTrackedEmail(...args),
}))

import { Modules } from "@medusajs/framework/utils"
import orderFinalChargeEmailHandler from "../../subscribers/order-final-charge-email"

function makeContainer() {
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
  const orderModule = { updateOrders: jest.fn(async () => undefined) }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      if (key === Modules.ORDER) return orderModule
      throw new Error(`Unexpected dependency ${key}`)
    }),
  }

  return { container, logger, orderModule }
}

describe("order final-charge email precondition alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts and skips sending when the order cannot be loaded", async () => {
    mockFetchOrderForEmail.mockResolvedValue(null)
    const { container, logger } = makeContainer()

    await orderFinalChargeEmailHandler({
      event: {
        data: {
          id: "evt_final_charge_123",
          order_id: "order_123",
          amount: 42,
        },
      },
      container,
    } as any)

    expect(mockEmitTransactionalEmailPreconditionAlert).toHaveBeenCalledWith({
      logger,
      templateKey: "order-final-charge",
      reason: "order_not_found",
      path: "src/subscribers/order-final-charge-email.ts",
      eventName: "order.final_charge_succeeded",
      eventId: "evt_final_charge_123",
      orderId: "order_123",
    })
    expect(mockSendTrackedEmail).not.toHaveBeenCalled()
  })

  it("alerts and skips sending when the final-charge order has no email", async () => {
    mockFetchOrderForEmail.mockResolvedValue({
      id: "order_123",
      display_id: 1001,
      email: null,
      metadata: {},
    })
    const { container, logger } = makeContainer()

    await orderFinalChargeEmailHandler({
      event: {
        data: {
          id: "evt_final_charge_123",
          order_id: "order_123",
          amount: 42,
        },
      },
      container,
    } as any)

    expect(mockEmitTransactionalEmailPreconditionAlert).toHaveBeenCalledWith({
      logger,
      templateKey: "order-final-charge",
      reason: "order_missing_email",
      path: "src/subscribers/order-final-charge-email.ts",
      eventName: "order.final_charge_succeeded",
      eventId: "evt_final_charge_123",
      orderId: "order_123",
      displayId: 1001,
    })
    expect(mockSendTrackedEmail).not.toHaveBeenCalled()
  })

  it("alerts when the final-charge email handler throws unexpectedly", async () => {
    const error = new Error("template render failed")
    mockFetchOrderForEmail.mockRejectedValue(error)
    const { container, logger } = makeContainer()

    await orderFinalChargeEmailHandler({
      event: {
        data: {
          id: "evt_final_charge_123",
          order_id: "order_123",
          amount: 42,
        },
      },
      container,
    } as any)

    expect(mockEmitTransactionalEmailHandlerFailureAlert).toHaveBeenCalledWith({
      logger,
      templateKey: "order-final-charge",
      path: "src/subscribers/order-final-charge-email.ts",
      eventName: "order.final_charge_succeeded",
      eventId: "evt_final_charge_123",
      orderId: "order_123",
      error,
    })
    expect(logger.error).toHaveBeenCalledWith(
      "[order-final-charge-email] failed for order order_123: template render failed"
    )
  })
})
