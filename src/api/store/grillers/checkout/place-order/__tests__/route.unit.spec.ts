import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"
import { getPaymentContextCustomer } from "../../../../payment-methods/utils"

jest.mock("../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Mock only getPaymentContextCustomer so we can drive the outer catch; keep
// jsonError real so the 400 input guards still behave normally.
jest.mock("../../../../payment-methods/utils", () => {
  const actual = jest.requireActual("../../../../payment-methods/utils")
  return {
    ...actual,
    getPaymentContextCustomer: jest.fn(),
  }
})

// Import POST AFTER mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require("../route")

function makeReqRes() {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const req = {
    body: {
      cart_id: "cart_test_123",
      payment_method_id: "pm_test_123",
      consent_version: "v1",
      consent_text: "I consent",
    },
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  } as any
  const res = {
    status: jest.fn(function status() {
      return this
    }),
    json: jest.fn(),
  } as any
  return { req, res, logger }
}

describe("place-order route ops alerting", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits a severity:page place_order_error alert and returns 500 when the handler throws", async () => {
    ;(getPaymentContextCustomer as jest.Mock).mockRejectedValueOnce(
      new Error("boom: stripe unavailable")
    )

    const { req, res } = makeReqRes()
    await POST(req, res)

    // HTTP response unchanged: still a generic 500.
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not place the order. Please try again.",
    })

    // Alert fired with the right shape.
    expect(emitOpsAlert).toHaveBeenCalledTimes(1)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "place_order_error",
        severity: "page",
        path: "store/grillers/checkout/place-order",
        title: "place-order 500: Error",
        meta: expect.objectContaining({
          cart_id: "cart_test_123",
          error_name: "Error",
          error_message: "boom: stripe unavailable",
        }),
      })
    )

    // No PII / card data leaks into the alert meta.
    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(meta).not.toHaveProperty("payment_method_id")
    expect(meta).not.toHaveProperty("setup_intent_id")
    expect(JSON.stringify(meta)).not.toContain("pm_test_123")
  })
})
