import { emitOpsAlert } from "../../../../lib/ops-alert"
import {
  requestPreferencesLink,
  verifyServiceApiKey,
} from "../../../../lib/communications/core"

jest.mock("../../../../lib/communications/core", () => ({
  requestPreferencesLink: jest.fn(),
  verifyServiceApiKey: jest.fn(() => true),
}))

jest.mock("../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require("../route")

function makeReqRes(email = "shopper@example.com") {
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
  const req = {
    body: { email },
    headers: { authorization: "Bearer service-key" },
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
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

describe("request preferences link route ops alerting", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(verifyServiceApiKey as jest.Mock).mockReturnValue(true)
    ;(requestPreferencesLink as jest.Mock).mockResolvedValue(undefined)
  })

  it("keeps the privacy-preserving 202 response but alerts when link work throws", async () => {
    ;(requestPreferencesLink as jest.Mock).mockRejectedValueOnce(
      new Error("profile upsert failed for shopper@example.com")
    )

    const { req, res, logger } = makeReqRes()
    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(202)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_preferences_link_failed",
        severity: "warn",
        title: "Communications preferences link request failed",
        path: "src/api/api/request-preferences-link/route.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          has_email: true,
          error_message: "profile upsert failed for [redacted-email]",
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("shopper@example.com")
  })

  it("does not alert when there is no email to process", async () => {
    const { req, res } = makeReqRes("")
    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(202)
    expect(requestPreferencesLink).not.toHaveBeenCalled()
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })
})
