import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

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

describe("final-charge refund route", () => {
  const originalFetch = global.fetch
  const originalStripeKey = process.env.STRIPE_API_KEY

  afterEach(() => {
    global.fetch = originalFetch
    process.env.STRIPE_API_KEY = originalStripeKey
    jest.restoreAllMocks()
  })

  function makeRes() {
    return {
      status: jest.fn(function status() {
        return this
      }),
      json: jest.fn(),
    } as any
  }

  it("refunds the Stripe final PaymentIntent and queues QBD refund posting", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    const stripeFetch = jest.fn(async (_url: string, init: any) => {
      const body = init.body as URLSearchParams
      expect(body.get("payment_intent")).toBe("pi_final_123")
      expect(body.get("amount")).toBe("1250")
      expect(init.headers["Idempotency-Key"]).toBe("refund-key-123")

      return {
        ok: true,
        json: async () => ({ id: "re_final_123", status: "succeeded" }),
      } as any
    })
    global.fetch = stripeFetch as any

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
          final_charge_refunded_amount: 10,
          staff_audit_log: "[]",
        },
      })),
      listOrderTransactions: jest.fn(async () => []),
      addOrderTransactions: jest.fn(async () => undefined),
      updateOrders: jest.fn(async () => undefined),
    }
    const eventBus = { emit: jest.fn(async () => undefined) }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      headers: { "idempotency-key": "refund-key-123" },
      body: { amount: 12.5, note: "Customer refund test" },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          throw new Error(`Unknown dependency ${key}`)
        },
      },
      auth_context: { actor_id: "user_123" },
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith({
      order_id: "order_123",
      amount: -12.5,
      currency_code: "usd",
      reference: "refund",
      reference_id: "re_final_123",
    })
    expect(orderModule.updateOrders).toHaveBeenCalledWith("order_123", {
      metadata: expect.objectContaining({
        final_charge_refunded_amount: 22.5,
        qbd_posting_required: true,
        qbd_posting_status: "pending_manual",
        qbd_posting_action: "card_refund_accounting_record",
        qbd_posting_amount: 1250,
        qbd_posting_request_key: "refund:re_final_123",
        stripe_refund_id: "re_final_123",
        final_charge_refunds: [
          expect.objectContaining({
            id: "re_final_123",
            amount: 12.5,
            amount_minor: 1250,
            idempotency_key: "refund-key-123",
          }),
        ],
      }),
    })
    expect(eventBus.emit).toHaveBeenCalledWith({
      name: "payment.refunded",
      data: {
        id: "final_charge:pi_final_123",
        payment_id: "final_charge:pi_final_123",
        refund_id: "re_final_123",
        order_id: "order_123",
        amount: 12.5,
        reason: "Customer refund test",
      },
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        id: "final_charge:pi_final_123",
        provider_id: "pp_stripe_final_charge",
        refunded_amount: 22.5,
        refunds: [
          expect.objectContaining({
            id: "re_final_123",
            amount: 12.5,
          }),
        ],
      }),
    })
  })

  it("returns an existing final-charge refund for an idempotent replay without touching Stripe", async () => {
    const stripeFetch = jest.fn()
    global.fetch = stripeFetch as any

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
          final_charge_refunded_amount: 22.5,
          final_charge_refunds: [
            {
              id: "re_final_123",
              amount: 12.5,
              amount_minor: 1250,
              idempotency_key: "refund-key-123",
              qbd_posting_request_key: "refund:re_final_123",
              created_at: "2026-06-12T15:00:00.000Z",
            },
          ],
          qbd_posting_status: "pending_manual",
          qbd_posting_request_key: "refund:re_final_123",
        },
      })),
      listOrderTransactions: jest.fn(),
      addOrderTransactions: jest.fn(),
      updateOrders: jest.fn(),
    }
    const eventBus = { emit: jest.fn() }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      headers: { "idempotency-key": "refund-key-123" },
      body: { amount: 12.5 },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          throw new Error(`Unknown dependency ${key}`)
        },
      },
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(stripeFetch).not.toHaveBeenCalled()
    expect(orderModule.listOrderTransactions).not.toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).not.toHaveBeenCalled()
    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(eventBus.emit).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        refunded_amount: 22.5,
        refunds: [expect.objectContaining({ id: "re_final_123", amount: 12.5 })],
      }),
    })
  })

  it("blocks final-charge refunds while another QBD posting is pending", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    const stripeFetch = jest.fn()
    global.fetch = stripeFetch as any

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
          qbd_posting_status: "pending_manual",
          qbd_posting_action: "final_card_charge_accounting_record",
          qbd_posting_request_key: "final_charge:pi_final_123",
        },
      })),
    }
    const eventBus = { emit: jest.fn() }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      headers: { "idempotency-key": "refund-key-456" },
      body: { amount: 10 },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          throw new Error(`Unknown dependency ${key}`)
        },
      },
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(stripeFetch).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        qbd_posting_request_key: "final_charge:pi_final_123",
      })
    )
  })

  it("rejects sub-cent refund amounts before calling Stripe", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    const stripeFetch = jest.fn()
    global.fetch = stripeFetch as any

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
        },
      })),
    }
    const eventBus = { emit: jest.fn() }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      body: { amount: 12.345 },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          throw new Error(`Unknown dependency ${key}`)
        },
      },
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(stripeFetch).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({
      message: "Refund amount cannot include more than 2 decimal places for USD.",
    })
  })
})
