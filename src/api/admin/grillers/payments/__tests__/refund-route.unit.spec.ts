import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/refund/route"
import { config as refundIssuedEmailConfig } from "../../../../../subscribers/refund-issued-email"

function makeAllocationDb(rows: any[] = []) {
  const updates: any[] = []
  const inserts: any[] = []
  const db: any = jest.fn((table: string) => {
    const chain: any = {
      select: jest.fn(() => chain),
      whereNull: jest.fn(() => chain),
      where: jest.fn(() => chain),
      whereIn: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      update: jest.fn(async (payload: any) => {
        updates.push({ table, payload })
        return 1
      }),
      insert: jest.fn(async (payload: any) => {
        inserts.push({ table, payload })
        return payload
      }),
      then: (resolve: any) =>
        resolve(table === "gp_inventory_allocation" ? rows : []),
    }

    return chain
  })

  return { db, updates, inserts }
}

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
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "pay_123" },
      body: { amount: 5, note: "Customer refund test" },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.PAYMENT) return paymentModule
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === "query") return query
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
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

  it("releases allocation quantities when staff submits line-level refund releases", async () => {
    const refund = {
      id: "refund_123",
      amount: 2,
      raw_amount: { value: "2" },
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
    const { db, updates, inserts } = makeAllocationDb([
      {
        id: "ialloc_123",
        order_id: "order_123",
        line_item_id: "line_123",
        quantity: 3,
        status: "reserved",
        metadata: {},
      },
    ])
    const req = {
      params: { id: "pay_123" },
      body: {
        amount: 2,
        note: "Partial refund",
        allocation_releases: [
          { order_id: "order_123", line_item_id: "line_123", quantity: 1 },
        ],
      },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.PAYMENT) return paymentModule
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === "query") return query
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
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

    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "gp_inventory_allocation",
          payload: expect.objectContaining({
            quantity: 2,
            allocation_reason: "released_refund",
          }),
        }),
      ])
    )
    expect(inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "gp_inventory_allocation_audit",
          payload: expect.objectContaining({
            allocation_id: "ialloc_123",
            previous_status: "reserved",
            next_status: "reserved",
            previous_quantity: 3,
            next_quantity: 2,
            reason: "released_refund",
          }),
        }),
      ])
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
