import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { generateResetPasswordTokenWorkflow } from "@medusajs/core-flows"
import { emitOpsAlert } from "../../../../lib/ops-alert"

jest.mock("@medusajs/core-flows", () => ({
  generateResetPasswordTokenWorkflow: jest.fn(),
}))

jest.mock("../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require("../route")

function makeReqRes(email = "avi@example.com") {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const config = { projectConfig: { http: { jwtSecret: "jwt-secret" } } }
  const req = {
    body: { email },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === ContainerRegistrationKeys.CONFIG_MODULE) return config
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

describe("forgot-password route ops alerting", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      POSTMARK_API_TOKEN: "postmark-token",
      POSTMARK_FROM: "support@grillerspride.com",
    }
    ;(generateResetPasswordTokenWorkflow as unknown as jest.Mock).mockReturnValue({
      run: jest.fn(async () => ({ result: "reset-token" })),
    })
  })

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
  })

  it("alerts when password reset email config is missing", async () => {
    delete process.env.POSTMARK_API_TOKEN

    const { req, res, logger } = makeReqRes()
    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({
      error: "email service misconfigured",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "forgot_password_email_failed",
        severity: "warn",
        title: "Forgot-password email failed",
        path: "src/api/store/forgot-password/route.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          failure_stage: "missing_config",
          response_status: null,
          provider_error: null,
        }),
      })
    )
  })

  it("alerts and redacts the email when Postmark rejects a password reset", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Recipient avi@example.com is suppressed",
    } as any)

    const { req, res } = makeReqRes()
    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: "email send failed" })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "forgot_password_email_failed",
        meta: expect.objectContaining({
          failure_stage: "postmark_rejected",
          response_status: 422,
          provider_error: "Recipient [redacted-email] is suppressed",
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("avi@example.com")
  })

  it("alerts when the Postmark password reset request throws", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("network reset for avi@example.com"))

    const { req, res } = makeReqRes()
    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: "email send failed" })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "forgot_password_email_failed",
        meta: expect.objectContaining({
          failure_stage: "request_failed",
          response_status: null,
          provider_error: "network reset for [redacted-email]",
        }),
      })
    )
  })
})
