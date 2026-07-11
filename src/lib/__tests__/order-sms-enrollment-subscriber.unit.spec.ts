import orderSmsEnrollmentConfirmationHandler, {
  config,
} from "../../subscribers/order-sms-enrollment-confirmation"
import { sendOrderSmsEnrollmentConfirmation } from "../communications/transactional-sms"
import { fetchOrderForEmail } from "../emails/order-fetch"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../emails/order-fetch", () => ({
  fetchOrderForEmail: jest.fn(),
}))

jest.mock("../communications/transactional-sms", () => ({
  sendOrderSmsEnrollmentConfirmation: jest.fn(),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => undefined),
}))

function fixtureContainer() {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        throw new Error(`unexpected resolve ${key}`)
      },
    } as any,
    logger,
  }
}

describe("order SMS enrollment confirmation subscriber", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(sendOrderSmsEnrollmentConfirmation as jest.Mock).mockResolvedValue({
      ok: true,
    })
  })

  it("subscribes to order placement and attempts the confirmation independently", async () => {
    expect(config.event).toBe("order.placed")
    const fixture = fixtureContainer()
    const order = {
      id: "order_1",
      metadata: { fulfillmentType: "ups_shipping" },
      shipping_address: { phone: "+14045550100" },
    }
    ;(fetchOrderForEmail as jest.Mock).mockResolvedValue(order)

    await orderSmsEnrollmentConfirmationHandler({
      event: { data: { id: "order_1" } },
      container: fixture.container,
    } as any)

    expect(sendOrderSmsEnrollmentConfirmation).toHaveBeenCalledWith(
      fixture.container,
      { order }
    )
  })

  it("contains failures without affecting other order.placed subscribers", async () => {
    const fixture = fixtureContainer()
    ;(fetchOrderForEmail as jest.Mock).mockResolvedValue({ id: "order_1" })
    ;(sendOrderSmsEnrollmentConfirmation as jest.Mock).mockRejectedValue(
      new Error("twilio unavailable")
    )

    await expect(
      orderSmsEnrollmentConfirmationHandler({
        event: { data: { id: "order_1" } },
        container: fixture.container,
      } as any)
    ).resolves.toBeUndefined()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_transactional_sms_send_failed",
        meta: expect.objectContaining({ order_id: "order_1" }),
      })
    )
  })
})
