import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { POST } from "../route"
import { emitOpsAlert } from "../../../../../../../../lib/ops-alert"

jest.mock("../../../../../../../../lib/ops-alert", () => ({
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
      already_refunded: true,
      payment: expect.objectContaining({
        refunded_amount: 22.5,
        refunds: [expect.objectContaining({ id: "re_final_123", amount: 12.5 })],
      }),
    })
  })

  it("does not silently replay equal-amount refunds when no idempotency header is provided", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    const stripeFetch = jest.fn(async (_url: string, init: any) => {
      expect(init.headers["Idempotency-Key"]).toMatch(
        /^final-charge-refund:order_123:pi_final_123:12\.5:[0-9a-f-]{36}$/
      )
      expect(init.headers["Idempotency-Key"]).not.toBe(
        "final-charge-refund:order_123:pi_final_123:12.5"
      )

      return {
        ok: true,
        json: async () => ({ id: "re_final_new", status: "succeeded" }),
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
          final_charge_refunded_amount: 12.5,
          final_charge_refunds: [
            {
              id: "re_final_old",
              amount: 12.5,
              amount_minor: 1250,
              idempotency_key:
                "final-charge-refund:order_123:pi_final_123:12.5",
              qbd_posting_request_key: "refund:re_final_old",
              created_at: "2026-06-12T15:00:00.000Z",
            },
          ],
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
      body: { amount: 12.5, note: "Second equal amount refund" },
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

    expect(stripeFetch).toHaveBeenCalled()
    expect(orderModule.addOrderTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "refund",
        reference_id: "re_final_new",
      })
    )
    expect(orderModule.updateOrders).toHaveBeenCalledWith("order_123", {
      metadata: expect.objectContaining({
        final_charge_refunded_amount: 25,
        stripe_refund_id: "re_final_new",
        qbd_posting_request_key: "refund:re_final_new",
        final_charge_refunds: [
          expect.objectContaining({ id: "re_final_old" }),
          expect.objectContaining({
            id: "re_final_new",
            idempotency_key: expect.stringMatching(
              /^final-charge-refund:order_123:pi_final_123:12\.5:[0-9a-f-]{36}$/
            ),
          }),
        ],
      }),
    })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      payment: expect.objectContaining({
        refunded_amount: 25,
        refunds: [expect.objectContaining({ id: "re_final_new", amount: 12.5 })],
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
    ;(emitOpsAlert as jest.Mock).mockClear()
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
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("pages when Stripe rejects a final-charge refund before money moves", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    ;(emitOpsAlert as jest.Mock).mockClear()
    const stripeFetch = jest.fn(async () => ({
      ok: false,
      json: async () => ({
        error: {
          message: "Stripe rejected pi_final_123 for avi@example.com",
        },
      }),
    })) as any
    global.fetch = stripeFetch

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
          final_charge_refunded_amount: 0,
          staff_audit_log: "[]",
        },
      })),
      listOrderTransactions: jest.fn(),
      addOrderTransactions: jest.fn(),
      updateOrders: jest.fn(),
    }
    const eventBus = { emit: jest.fn() }
    const logger = { warn: jest.fn(), error: jest.fn() }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      headers: { "idempotency-key": "refund-key-stripe-fail" },
      body: { amount: 25 },
      scope: {
        resolve: (key: string) => {
          if (key === Modules.ORDER) return orderModule
          if (key === Modules.EVENT_BUS) return eventBus
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          if (key === ContainerRegistrationKeys.LOGGER) return logger
          throw new Error(`Unknown dependency ${key}`)
        },
      },
      auth_context: { actor_id: "user_123" },
    } as any
    const res = makeRes()

    await POST(req, res)

    expect(stripeFetch).toHaveBeenCalled()
    expect(orderModule.listOrderTransactions).not.toHaveBeenCalled()
    expect(orderModule.updateOrders).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "final_charge_refund_route_failed",
        severity: "page",
        title: "Final-charge refund failed during refund_stripe",
        path: "src/api/admin/grillers/orders/[id]/finalization/refund-final-charge/route.ts",
        logger,
        meta: expect.objectContaining({
          order_id: "order_123",
          stage: "refund_stripe",
          stripe_payment_intent_id: "pi_final_123",
          actor_id: "user_123",
          refund_completed: false,
          error_message: "Stripe rejected [redacted-id] for [redacted-email]",
        }),
      })
    )
  })

  it("pages refund_recorded_mismatch when Stripe refunded but Medusa recording throws", async () => {
    process.env.STRIPE_API_KEY = "sk_test_123"
    ;(emitOpsAlert as jest.Mock).mockClear()
    const stripeFetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ id: "re_final_999", status: "succeeded" }),
    })) as any
    global.fetch = stripeFetch

    const orderModule = {
      retrieveOrder: jest.fn(async () => ({
        id: "order_123",
        currency_code: "usd",
        total: 100,
        metadata: {
          final_charge_status: "succeeded",
          stripe_payment_intent_id: "pi_final_123",
          final_total: 100,
          final_charge_refunded_amount: 0,
          staff_audit_log: "[]",
        },
      })),
      listOrderTransactions: jest.fn(async () => []),
      addOrderTransactions: jest.fn(async () => undefined),
      // Money already left Stripe; the ledger write throws here.
      updateOrders: jest.fn(async () => {
        throw new Error("db write failed")
      }),
    }
    const eventBus = { emit: jest.fn(async () => undefined) }
    const { db } = makeAllocationDb()
    const req = {
      params: { id: "order_123" },
      headers: { "idempotency-key": "refund-key-999" },
      body: { amount: 25 },
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

    // Stripe was hit (money moved) and the ledger write failed.
    expect(stripeFetch).toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "refund_recorded_mismatch",
        severity: "page",
        path: "src/api/admin/grillers/orders/[id]/finalization/refund-final-charge/route.ts",
        meta: expect.objectContaining({
          stripe_refund_id: "re_final_999",
          order_id: "order_123",
        }),
      })
    )
    // Response surfaces the mismatch with the Stripe refund id, unchanged.
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_refund_id: "re_final_999" })
    )
  })
})
