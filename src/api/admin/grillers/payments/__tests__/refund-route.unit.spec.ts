import { Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/refund/route"
import { config as refundIssuedEmailConfig } from "../../../../../subscribers/refund-issued-email"

describe("staff payment refund route", () => {
  it("routes refund emails from the payment refunded event", () => {
    expect(refundIssuedEmailConfig.event).toBe("payment.refunded")
  })

  it("emits the Medusa payment refunded event for customer refund emails", async () => {
    const refund = {
      id: "refund_123",
      amount: 5,
      raw_amount: { value: "5" },
      data: { id: "re_123" },
    }
    const paymentModule = {
      retrievePayment: jest.fn(async () => ({
        id: "pay_123",
        payment_collection_id: "paycol_123",
        currency_code: "usd",
        refunds: [],
      })),
      refundPayment: jest.fn(async () => ({
        id: "pay_123",
        payment_collection_id: "paycol_123",
        currency_code: "usd",
        refunds: [refund],
      })),
    }
    const orderModule = {
      listOrderTransactions: jest.fn(async () => []),
      addOrderTransactions: jest.fn(async () => undefined),
    }
    const eventBus = {
      emit: jest.fn(async () => undefined),
    }
    const query = {
      graph: jest.fn(async () => ({
        data: [{ order_id: "order_123" }],
      })),
    }
    const req = {
      params: { id: "pay_123" },
      body: { amount: 5, note: "Customer refund test" },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.PAYMENT) return paymentModule
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === "query") return query
          throw new Error(`Unknown dependency ${key}`)
        },
      },
      auth_context: { actor_id: "user_123" },
    } as any
    const res = {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any

    await POST(req, res)

    expect(paymentModule.refundPayment).toHaveBeenCalledWith({
      payment_id: "pay_123",
      amount: 5,
      note: "Customer refund test",
      refund_reason_id: undefined,
      created_by: "user_123",
    })
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith({
      order_id: "order_123",
      amount: -5,
      currency_code: "usd",
      reference: "refund",
      reference_id: "refund_123",
    })
    expect(eventBus.emit).toHaveBeenCalledWith({
      name: "payment.refunded",
      data: {
        id: "pay_123",
        payment_id: "pay_123",
        refund_id: "refund_123",
        order_id: "order_123",
        amount: 5,
        reason: "Customer refund test",
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
