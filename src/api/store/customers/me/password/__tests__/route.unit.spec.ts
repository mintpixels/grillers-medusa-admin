import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateCustomerEmailpassPassword } from "../../../../../../lib/customer-password-update"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

jest.mock("../../../../../../lib/customer-password-update", () => ({
  updateCustomerEmailpassPassword: jest.fn(),
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
    auth_context: {
      actor_id: "cus_actor",
      auth_identity_id: "auth_actor",
    },
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return {}
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  } as any

  return { logger, req }
}

describe("customer password change route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("does not alert when the current password is incorrect", async () => {
    ;(updateCustomerEmailpassPassword as jest.Mock).mockResolvedValueOnce({
      status: "no_match",
    })
    const { req } = makeReq({
      current_password: "old-password",
      new_password: "new-password",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      message: "Current password is incorrect",
    })
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("alerts and redacts when the password update throws", async () => {
    ;(updateCustomerEmailpassPassword as jest.Mock).mockRejectedValueOnce(
      new Error("provider update failed for person@example.com and cus_123")
    )
    const { logger, req } = makeReq({
      current_password: "old-password",
      new_password: "new-password",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not update password. Please try again.",
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[customer-password] update failed")
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "customer_auth_route_failed",
        severity: "page",
        title: "Customer auth route failed: password_change",
        path: "src/api/store/customers/me/password/route.ts",
        source: "medusa-server",
        fingerprint: "customer_auth_route_failed:password_change",
        logger,
        meta: expect.objectContaining({
          action: "password_change",
          actor_id: "cus_actor",
          has_auth_identity_id: true,
          identifier_kind: null,
          error_message:
            "provider update failed for [redacted-email] and [redacted-id]",
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("person@example.com")
  })
})
