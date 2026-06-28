import { createHmac } from "node:crypto"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const mockEmitChargeFailedPostShipAlert = jest.fn(async (_input: any) => ({
  ok: true,
}))
const mockEmitStripePaymentFailedWebhookInvalidSignatureAlert = jest.fn(
  async (_input: any) => ({ ok: true })
)
const mockEmitStripePaymentFailedWebhookProcessingFailedAlert = jest.fn(
  async (_input: any) => ({ ok: true })
)

jest.mock("../../../../../lib/final-charge-ops-alerts", () => ({
  emitChargeFailedPostShipAlert: (input: any) =>
    mockEmitChargeFailedPostShipAlert(input),
  emitStripePaymentFailedWebhookInvalidSignatureAlert: (input: any) =>
    mockEmitStripePaymentFailedWebhookInvalidSignatureAlert(input),
  emitStripePaymentFailedWebhookProcessingFailedAlert: (input: any) =>
    mockEmitStripePaymentFailedWebhookProcessingFailedAlert(input),
}))

import { POST } from "../route"

const SECRET = "whsec_test_secret"

function signature(rawBody: string, timestamp: number) {
  const digest = createHmac("sha256", SECRET)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")
  return `t=${timestamp},v1=${digest}`
}

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

function makeReq({
  body,
  db,
  rawBody = JSON.stringify(body),
  stripeSignature,
}: {
  body: Record<string, any>
  db?: any
  rawBody?: string
  stripeSignature?: string
}) {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  return {
    body,
    headers: stripeSignature ? { "stripe-signature": stripeSignature } : {},
    rawBody,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any
}

describe("Stripe payment-failed webhook telemetry", () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET
  const originalNow = Date.now

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = SECRET
    Date.now = jest.fn(() => 1_700_000_000_000)
  })

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET
    else process.env.STRIPE_WEBHOOK_SECRET = originalSecret
    Date.now = originalNow
  })

  it("warns when an invalid signature prevents payment-failed processing", async () => {
    const body = {
      type: "payment_intent.payment_failed",
      data: { object: { id: "pi_123" } },
    }
    const req = makeReq({
      body,
      rawBody: JSON.stringify(body),
      stripeSignature: "t=1700000000,v1=bad",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "invalid_signature",
    })
    expect(
      mockEmitStripePaymentFailedWebhookInvalidSignatureAlert
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        hasSignatureHeader: true,
      })
    )
    expect(mockEmitChargeFailedPostShipAlert).not.toHaveBeenCalled()
  })

  it("pages when a valid payment-failed webhook cannot query finalization state", async () => {
    const body = {
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_123",
          status: "requires_payment_method",
          last_payment_error: { code: "card_declined", message: "Declined" },
        },
      },
    }
    const rawBody = JSON.stringify(body)
    const db = jest.fn(() => {
      throw new Error("database unavailable")
    })
    const req = makeReq({
      body,
      db,
      rawBody,
      stripeSignature: signature(rawBody, 1_700_000_000),
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "processing_failed",
    })
    expect(
      mockEmitStripePaymentFailedWebhookProcessingFailedAlert
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: "pi_123",
        error: expect.any(Error),
      })
    )
    expect(mockEmitChargeFailedPostShipAlert).not.toHaveBeenCalled()
  })
})
