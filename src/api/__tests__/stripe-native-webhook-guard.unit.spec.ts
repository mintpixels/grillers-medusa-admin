import { createHmac } from "node:crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { verifyNativeStripeWebhookSignature } from "../middlewares"

const NATIVE_SECRET = "whsec_native_endpoint"
const PAYMENT_FAILED_SECRET = "whsec_payment_failed_endpoint"
const NOW_MS = 1_700_000_000_000
const RAW_BODY = JSON.stringify({
  id: "evt_native_test",
  type: "payment_intent.payment_failed",
  data: { object: { id: "pi_test" } },
})

function signature(secret: string) {
  const timestamp = Math.floor(NOW_MS / 1000)
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${RAW_BODY}`, "utf8")
    .digest("hex")
  return `t=${timestamp},v1=${digest}`
}

function makeReq(stripeSignature: string | undefined) {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return {
    req: {
      rawBody: Buffer.from(RAW_BODY),
      headers: stripeSignature
        ? { "stripe-signature": stripeSignature }
        : {},
      scope: {
        resolve: (key: string) => {
          if (key === ContainerRegistrationKeys.LOGGER) return logger
          throw new Error(`unexpected dependency ${key}`)
        },
      },
    } as any,
    logger,
  }
}

function makeRes() {
  const json = jest.fn()
  const status = jest.fn().mockReturnValue({ json })
  return { status, json, _json: json } as any
}

describe("native Medusa Stripe webhook guard", () => {
  const originalNativeSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalPaymentFailedSecret =
    process.env.STRIPE_PAYMENT_FAILED_WEBHOOK_SECRET
  const originalNow = Date.now
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = NATIVE_SECRET
    process.env.STRIPE_PAYMENT_FAILED_WEBHOOK_SECRET =
      PAYMENT_FAILED_SECRET
    Date.now = jest.fn(() => NOW_MS)
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any
  })

  afterEach(() => {
    if (originalNativeSecret === undefined) {
      delete process.env.STRIPE_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_WEBHOOK_SECRET = originalNativeSecret
    }
    if (originalPaymentFailedSecret === undefined) {
      delete process.env.STRIPE_PAYMENT_FAILED_WEBHOOK_SECRET
    } else {
      process.env.STRIPE_PAYMENT_FAILED_WEBHOOK_SECRET =
        originalPaymentFailedSecret
    }
    Date.now = originalNow
    global.fetch = originalFetch
  })

  it("allows a signature made with the native endpoint secret", async () => {
    const { req } = makeReq(signature(NATIVE_SECRET))
    const res = makeRes()
    const next = jest.fn()

    await verifyNativeStripeWebhookSignature(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it("rejects a signature made with the custom payment-failed secret", async () => {
    const { req } = makeReq(signature(PAYMENT_FAILED_SECRET))
    const res = makeRes()
    const next = jest.fn()

    await verifyNativeStripeWebhookSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res._json).toHaveBeenCalledWith({
      ok: false,
      error: "invalid_signature",
    })
    expect(next).not.toHaveBeenCalled()
  })

  it("rejects an unsigned request", async () => {
    const { req } = makeReq(undefined)
    const res = makeRes()
    const next = jest.fn()

    await verifyNativeStripeWebhookSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(next).not.toHaveBeenCalled()
  })

  it("fails closed when the native secret is missing even if the custom secret is set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const { req, logger } = makeReq(signature(PAYMENT_FAILED_SECRET))
    const res = makeRes()
    const next = jest.fn()

    await verifyNativeStripeWebhookSignature(req, res, next)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res._json).toHaveBeenCalledWith({
      ok: false,
      error: "webhook_secret_missing",
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.not.stringContaining("whsec_")
    )
    expect(next).not.toHaveBeenCalled()
  })
})
