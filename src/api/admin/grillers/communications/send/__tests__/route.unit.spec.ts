import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendStaffMessage } from "../../../../../../lib/communications/admin"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

jest.mock("../../../../../../lib/communications/admin", () => ({
  sendStaffMessage: jest.fn(),
}))

jest.mock("../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

import { POST } from "../route"

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

function makeReq(body: Record<string, unknown>) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  const req = {
    auth_context: { actor_id: "staff_123" },
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any

  return { logger, req }
}

describe("admin communications staff-send route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("alerts when staff message delivery returns ok=false", async () => {
    ;(sendStaffMessage as jest.Mock).mockResolvedValueOnce({
      ok: false,
      error: "Postmark rejected avi@example.com",
    })
    const { logger, req } = makeReq({
      to: "customer@example.com",
      subject: "Order note",
      body: "Please call us.",
      stream: "transactional",
      order_id: "order_123",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "Postmark rejected avi@example.com",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "admin_communications_route_failed",
        severity: "page",
        title: "Admin communications route failed: send_staff_message",
        path: "src/api/admin/grillers/communications",
        logger,
        meta: expect.objectContaining({
          action: "send_staff_message",
          actor_id: "staff_123",
          route_status: 500,
          stream: "transactional",
          has_order_id: true,
          has_profile_id: false,
          error_message: "Postmark rejected [redacted-email]",
        }),
      })
    )
  })

  it("alerts and returns a generic error when staff message delivery throws", async () => {
    ;(sendStaffMessage as jest.Mock).mockRejectedValueOnce(
      new Error("SMTP failed for customer@example.com")
    )
    const { req } = makeReq({
      to: "customer@example.com",
      subject: "Order note",
      body: "Please call us.",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "staff_message_send_failed",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "admin_communications_route_failed",
        meta: expect.objectContaining({
          action: "send_staff_message",
          error_message: "SMTP failed for [redacted-email]",
        }),
      })
    )
  })
})
