import { emitOpsAlert } from "../ops-alert"
import {
  emitCommunicationEmailFailureAlert,
  emitCommunicationEventSideEffectAlert,
} from "../communications/core"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("communications ops alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits a safe ops alert when tracked email delivery fails", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }

    await emitCommunicationEmailFailureAlert({
      logger: logger as any,
      messageLogId: "gpmsg_123",
      purpose: "transactional",
      error: "Postmark rejected recipient avi@example.com with 422",
      input: {
        to: "avi@example.com",
        stream: "transactional",
        purpose: "transactional",
        template_key: "order-placed",
        topic: "order_updates",
        subject: "Your order",
        html: "<p>Order</p>",
        order_id: "order_123",
        cart_id: "cart_123",
        flow_id: "flow_123",
        flow_key: "cart-recovery",
        flow_enrollment_id: "enroll_123",
        campaign_id: "camp_123",
        postmark_template_alias: "order-placed",
        profile_id: "gpcprof_123",
        medusa_customer_id: "cus_123",
        metadata: {
          email: "avi@example.com",
        },
      },
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_email_send_failed",
        severity: "warn",
        title: "order-placed email send failed",
        path: "src/lib/communications/core.ts:sendTrackedEmail",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          message_log_id: "gpmsg_123",
          stream: "transactional",
          purpose: "transactional",
          template_key: "order-placed",
          topic: "order_updates",
          order_id: "order_123",
          cart_id: "cart_123",
          campaign_id: "camp_123",
          flow_id: "flow_123",
          flow_key: "cart-recovery",
          flow_enrollment_id: "enroll_123",
          postmark_template_alias: "order-placed",
          has_profile_id: true,
          has_medusa_customer_id: true,
          provider_error:
            "Postmark rejected recipient [redacted-email] with 422",
        }),
      })
    )

    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(JSON.stringify(meta)).not.toContain("avi@example.com")
  })

  it.each([
    [
      "destination_delivery",
      "communications_event_destination_delivery_failed",
      "Communications destination delivery failed for order_completed",
    ],
    [
      "automation_side_effect",
      "communications_event_automation_side_effect_failed",
      "Communications automation side effect failed for order_completed",
    ],
  ] as const)(
    "emits a safe ops alert when a communications event %s fails",
    async (sideEffect, alertKind, title) => {
      await emitCommunicationEventSideEffectAlert({
        sideEffect,
        error: new Error("destination rejected avi@example.com"),
        row: {
          id: "gpcevt_123",
          event_id: "evt_123",
          event_name: "order_completed",
          source: "medusa-server",
          profile_id: "gpcprof_123",
          medusa_customer_id: "cus_123",
          order_id: "order_123",
          cart_id: "cart_123",
          campaign_id: "camp_123",
          flow_id: "flow_123",
          template_key: "order-placed",
          message_id: "gpmsg_123",
        },
      })

      expect(emitOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertKind,
          severity: "warn",
          title,
          path: "src/lib/communications/core.ts:recordCommunicationEvent",
          source: "medusa-server",
          meta: expect.objectContaining({
            side_effect: sideEffect,
            communication_event_id: "gpcevt_123",
            event_id: "evt_123",
            event_name: "order_completed",
            event_source: "medusa-server",
            template_key: "order-placed",
            order_id: "order_123",
            cart_id: "cart_123",
            campaign_id: "camp_123",
            flow_id: "flow_123",
            message_id: "gpmsg_123",
            has_profile_id: true,
            has_medusa_customer_id: true,
            error: "destination rejected [redacted-email]",
          }),
        })
      )

      const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
      expect(JSON.stringify(meta)).not.toContain("avi@example.com")
    }
  )
})
