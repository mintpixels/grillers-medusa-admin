import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../[id]/refund/route"
import { config as refundIssuedEmailConfig } from "../../../../../subscribers/refund-issued-email"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

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
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: { qbd_existing: "kept" },
      })),
      updateOrders: jest.fn(async () => undefined),
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
    expect(orderModule.updateOrders).toHaveBeenCalledWith("order_123", {
      metadata: expect.objectContaining({
        qbd_existing: "kept",
        qbd_posting_required: true,
        qbd_posting_status: "pending_manual",
        qbd_posting_action: "card_refund_accounting_record",
        qbd_posting_amount: 500,
        qbd_posting_request_key: "refund:refund_123",
        stripe_refund_id: "refund_123",
        stripe_provider_refund_id: "re_123",
      }),
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
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: {},
      })),
      updateOrders: jest.fn(async () => undefined),
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

  it("emits an ops alert when a refund overwrites a pending QBD posting request", async () => {
    const refund = {
      id: "refund_new",
      amount: 5,
      raw_amount: { value: "5" },
      data: { id: "re_new" },
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
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        metadata: {
          qbd_posting_status: "pending_manual",
          qbd_posting_request_key: "final_charge:pi_existing",
        },
      })),
      updateOrders: jest.fn(async () => undefined),
    }
    const eventBus = {
      emit: jest.fn(async () => undefined),
    }
    const query = {
      graph: jest.fn(async () => ({
        data: [{ order_id: "order_123" }],
      })),
    }
    const logger = { warn: jest.fn(), error: jest.fn() }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "pay_123" },
      body: { amount: 5, note: "Refund after pending posting" },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.PAYMENT) return paymentModule
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === "query") return query
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          if (key === ContainerRegistrationKeys.LOGGER) return logger
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
    ;(emitOpsAlert as jest.Mock).mockClear()

    await POST(req, res)

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_overwritten",
        path: "src/api/admin/grillers/payments/[id]/refund/route.ts",
        meta: expect.objectContaining({
          order_id: "order_123",
          refund_id: "refund_new",
          previous_qbd_posting_request_key: "final_charge:pi_existing",
          next_qbd_posting_request_key: "refund:refund_new",
        }),
      })
    )
  })
})
