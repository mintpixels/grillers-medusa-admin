import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  authenticateLegacyCustomerLogin,
  generateLegacyCustomerAuthToken,
} from "../../../../../lib/legacy-customer-auth"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/legacy-customer-auth", () => ({
  authenticateLegacyCustomerLogin: jest.fn(),
  generateLegacyCustomerAuthToken: jest.fn(),
  normalizeLegacyLoginIdentifier: jest.fn((value) => String(value || "").trim()),
}))

jest.mock("../../../../../lib/ops-alert", () => ({
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
  const config = { projectConfig: { http: { jwtSecret: "jwt-secret" } } }
  const req = {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return {}
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) return config
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  } as any

  return { logger, req }
}

describe("legacy auth login route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(generateLegacyCustomerAuthToken as jest.Mock).mockReturnValue("jwt-token")
  })

  it("does not alert on invalid legacy credentials", async () => {
    ;(authenticateLegacyCustomerLogin as jest.Mock).mockResolvedValue(null)
    const { req } = makeReq({
      identifier: "shopper@example.com",
      password: "wrong-password",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      message: "Invalid login or password",
    })
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })

  it("alerts and redacts when legacy login infrastructure fails", async () => {
    ;(authenticateLegacyCustomerLogin as jest.Mock).mockRejectedValueOnce(
      new Error("legacy login query failed for shopper@example.com and cus_123")
    )
    const { logger, req } = makeReq({
      email: "shopper@example.com",
      password: "correct-password",
    })
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      message: "Could not sign in. Please try again.",
    })
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("[legacy-auth] login failed")
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "customer_auth_route_failed",
        severity: "page",
        title: "Customer auth route failed: legacy_login",
        path: "src/api/store/legacy-auth/login/route.ts",
        source: "medusa-server",
        fingerprint: "customer_auth_route_failed:legacy_login",
        logger,
        meta: expect.objectContaining({
          action: "legacy_login",
          identifier_kind: "email",
          error_message:
            "legacy login query failed for [redacted-email] and [redacted-id]",
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("shopper@example.com")
  })
})
