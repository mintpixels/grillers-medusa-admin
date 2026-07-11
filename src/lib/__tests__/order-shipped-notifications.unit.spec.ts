import orderShippedEmailHandler, {
  config,
  shipmentTrackingDetails,
} from "../../subscribers/order-shipped-email"
import { fetchOrderForEmail } from "../emails/order-fetch"
import { sendTrackedEmail } from "../communications/core"
import { sendOrderShippedSms } from "../communications/transactional-sms"

jest.mock("../emails/order-fetch", () => ({
  fetchOrderForEmail: jest.fn(),
}))

jest.mock("../emails/ops-alerts", () => ({
  emitTransactionalEmailHandlerFailureAlert: jest.fn(),
  emitTransactionalEmailPreconditionAlert: jest.fn(),
}))

jest.mock("../communications/core", () => ({
  sendTrackedEmail: jest.fn(),
}))

jest.mock("../communications/transactional-sms", () => ({
  sendOrderShippedSms: jest.fn(),
}))

function fixtureContainer(graph = jest.fn()) {
  const logger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  }
  return {
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === "query") return { graph }
        throw new Error(`unexpected resolve ${key}`)
      },
    } as any,
    graph,
    logger,
  }
}

describe("order shipped notification subscriber", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(sendOrderShippedSms as jest.Mock).mockResolvedValue({ ok: true })
  })

  it("subscribes only to the real shipment event", () => {
    expect(config.event).toBe("shipment.created")
  })

  it("honors no_notification before any order or provider work", async () => {
    const fixture = fixtureContainer()
    await orderShippedEmailHandler({
      event: {
        data: {
          id: "ful_skip",
          order_id: "order_skip",
          no_notification: true,
        },
      },
      container: fixture.container,
    } as any)
    expect(fixture.graph).not.toHaveBeenCalled()
    expect(fetchOrderForEmail).not.toHaveBeenCalled()
    expect(sendTrackedEmail).not.toHaveBeenCalled()
    expect(sendOrderShippedSms).not.toHaveBeenCalled()
  })

  it("falls back to retained fulfillment labels for tracking", () => {
    expect(
      shipmentTrackingDetails(
        { id: "ful_1" },
        {
          labels: [
            {
              tracking_number: "1ZLABEL",
              tracking_url: "https://tracking.example/1ZLABEL",
            },
          ],
          metadata: { carrier: "UPS" },
        }
      )
    ).toEqual({
      carrier: "UPS",
      trackingNumber: "1ZLABEL",
      trackingUrl: "https://tracking.example/1ZLABEL",
    })
  })

  it("still runs SMS when the independent email send fails", async () => {
    const fixture = fixtureContainer(
      jest.fn().mockResolvedValue({
        data: [
          {
            id: "ful_1",
            labels: [{ tracking_number: "1ZLABEL" }],
            metadata: {},
          },
        ],
      })
    )
    ;(fetchOrderForEmail as jest.Mock).mockResolvedValue({
      id: "order_1",
      display_id: 101,
      email: "shopper@example.com",
      metadata: { fulfillmentType: "ups_shipping" },
    })
    ;(sendTrackedEmail as jest.Mock).mockRejectedValue(
      new Error("postmark unavailable")
    )

    await orderShippedEmailHandler({
      event: { data: { id: "ful_1", order_id: "order_1" } },
      container: fixture.container,
    } as any)

    expect(sendOrderShippedSms).toHaveBeenCalledWith(
      fixture.container,
      expect.objectContaining({
        fulfillmentId: "ful_1",
        trackingNumber: "1ZLABEL",
      })
    )
  })
})
