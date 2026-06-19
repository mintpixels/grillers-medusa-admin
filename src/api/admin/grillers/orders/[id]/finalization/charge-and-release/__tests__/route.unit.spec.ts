import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

// Keep the real assert + constants (the assert is the gate under test); mock
// only the heavy IO helpers so we can drive paymentIntent.status directly.
const mockCreateStripeFinalPaymentIntent = jest.fn()
const mockPreviewFinalization = jest.fn()
const mockRecordFinalChargeAttempt = jest.fn()

jest.mock("../../../../../../../../lib/catch-weight-finalization", () => {
  const actual = jest.requireActual(
    "../../../../../../../../lib/catch-weight-finalization"
  )
  return {
    ...actual,
    createStripeFinalPaymentIntent: (...args: any[]) =>
      mockCreateStripeFinalPaymentIntent(...args),
    previewFinalization: (...args: any[]) => mockPreviewFinalization(...args),
    recordFinalChargeAttempt: (...args: any[]) =>
      mockRecordFinalChargeAttempt(...args),
  }
})

jest.mock("../../utils", () => ({
  jsonError: (res: any, status: number, message: string, extra?: any) => {
    res.status(status).json({ message, ...(extra || {}) })
    return res
  },
  retrieveFinalizationOrder: (...args: any[]) =>
    mockRetrieveFinalizationOrder(...args),
  staffAuditActorId: () => "user_123",
  staffAuditFields: () => ({}),
}))

const mockRetrieveFinalizationOrder = jest.fn()

jest.mock("../../../../../../../../lib/wwex-finalization-shipment", () => ({
  quoteWwexFinalizationShipping: jest.fn(async () => null),
  bookWwexFinalizationShipment: jest.fn(async () => ({ metadata: {} })),
}))

jest.mock("../../../../../../../../lib/final-charge-ops-alerts", () => ({
  emitChargeFailedHoldAlert: jest.fn(async () => ({ ok: true })),
  emitChargeMarkedReadyButPiNotSucceededAlert: jest.fn(async () => ({ ok: true })),
  emitFinalChargeNonSucceededAlert: jest.fn(async () => ({ ok: true })),
}))

import { POST } from "../route"
import {
  FINALIZATION_CHARGED_READY_TO_SHIP,
  FINALIZATION_PACKED_PENDING_CHARGE,
} from "../../../../../../../../lib/catch-weight-finalization"
import {
  emitChargeMarkedReadyButPiNotSucceededAlert,
  emitFinalChargeNonSucceededAlert,
} from "../../../../../../../../lib/final-charge-ops-alerts"

function makeDb() {
  const chain: any = {
    where: jest.fn(() => chain),
    update: jest.fn(async () => 1),
    insert: jest.fn(async () => undefined),
  }
  return jest.fn(() => chain)
}

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

function makeScope(db: any) {
  const orderModule = {
    listOrderTransactions: jest.fn(async () => []),
    addOrderTransactions: jest.fn(async () => undefined),
    updateOrders: jest.fn(async () => undefined),
  }
  const eventBus = { emit: jest.fn(async () => undefined) }
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const scope = {
    resolve: (key: string) => {
      if (key === Modules.ORDER) return orderModule
      if (key === Modules.EVENT_BUS) return eventBus
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
      if (key === ContainerRegistrationKeys.LOGGER) return logger
      throw new Error(`Unknown dependency ${key}`)
    },
  }
  return { scope, orderModule, eventBus, logger }
}

function basePreview() {
  return {
    errors: [],
    finalization: {
      id: "fin_123",
      status: FINALIZATION_PACKED_PENDING_CHARGE,
      currency_code: "usd",
      metadata: {},
    },
    payment_setup: {
      stripe_payment_method_id: "pm_123",
      stripe_customer_id: "cus_123",
    },
    totals: { final_order_total: 5000 },
    lines: [],
    packages: [],
    package_capture_required: false,
  }
}

describe("charge-and-release PI gate", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRetrieveFinalizationOrder.mockResolvedValue({
      id: "order_123",
      currency_code: "usd",
      display_id: 42,
      metadata: {},
    })
    mockPreviewFinalization.mockResolvedValue(basePreview())
    mockRecordFinalChargeAttempt.mockResolvedValue({ id: "attempt_123" })
  })

  it("does NOT alert and proceeds when the PaymentIntent succeeded", async () => {
    mockCreateStripeFinalPaymentIntent.mockResolvedValue({
      id: "pi_ok_123",
      status: "succeeded",
      latest_charge: "ch_123",
    })

    const db = makeDb()
    const { scope } = makeScope(db)
    const req = { params: { id: "order_123" }, body: {}, scope } as any
    const res = makeRes()

    await POST(req, res)

    expect(emitFinalChargeNonSucceededAlert).not.toHaveBeenCalled()
    expect(emitChargeMarkedReadyButPiNotSucceededAlert).not.toHaveBeenCalled()
    // Normal flow: succeeded → marks finalization ready_to_ship via db update.
    const updatedToReady = db.mock.results.some((r: any) =>
      r.value.update.mock.calls.some((c: any[]) =>
        Object.values(c[0] || {}).includes(FINALIZATION_CHARGED_READY_TO_SHIP)
      )
    )
    expect(updatedToReady).toBe(true)
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it("pages charge_marked_ready_but_pi_not_succeeded when status is processing, and the transition is blocked (response unchanged)", async () => {
    mockCreateStripeFinalPaymentIntent.mockResolvedValue({
      id: "pi_proc_123",
      status: "processing",
    })

    const db = makeDb()
    const { scope } = makeScope(db)
    const req = { params: { id: "order_123" }, body: {}, scope } as any
    const res = makeRes()

    await POST(req, res)

    // The money-critical guard alert fired before the assert.
    expect(emitChargeMarkedReadyButPiNotSucceededAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "order_123",
        finalizationId: "fin_123",
        paymentIntentId: "pi_proc_123",
        paymentIntentStatus: "processing",
        amount: 5000,
        blocked: true,
      })
    )
    // The existing non-succeeded alert also fired (unchanged behavior).
    expect(emitFinalChargeNonSucceededAlert).toHaveBeenCalled()
    // The assert tripped: the order was NOT marked ready_to_ship.
    const updatedToReady = db.mock.results.some((r: any) =>
      r.value.update.mock.calls.some((c: any[]) =>
        Object.values(c[0] || {}).includes(FINALIZATION_CHARGED_READY_TO_SHIP)
      )
    )
    expect(updatedToReady).toBe(false)
    // Response is the existing 402 charge-failed-hold path, unchanged.
    expect(res.status).toHaveBeenCalledWith(402)
  })
})
