import crypto from "crypto"

jest.mock("../../../../../lib/communications/sms", () => {
  const actual = jest.requireActual("../../../../../lib/communications/sms")
  return {
    ...actual,
    applyInboundSmsConsentChange: jest.fn(),
    applyMarketingSmsStatus: jest.fn(),
  }
})

import {
  applyInboundSmsConsentChange,
  applyMarketingSmsStatus,
} from "../../../../../lib/communications/sms"
import {
  POST as inboundPost,
  marketingInboundClassificationInput,
  marketingKeywordReplyOwnedByTwilio,
} from "../route"
import { POST as statusPost } from "../status/route"

function makeRes() {
  return {
    setHeader: jest.fn(),
    status: jest.fn(function status(this: any) {
      return this
    }),
    send: jest.fn(),
  } as any
}

function twilioSignature(
  token: string,
  url: string,
  params: Record<string, string>
) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("")
  return crypto
    .createHmac("sha1", token)
    .update(Buffer.from(data, "utf8"))
    .digest("base64")
}

function makeReq(
  body: Record<string, string>,
  options: {
    db?: any
    query?: Record<string, string>
    signature?: string
  } = {}
) {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  return {
    body,
    headers: {
      "x-twilio-signature": options.signature || "invalid-signature",
    },
    query: options.query || {},
    scope: {
      resolve: (key: string) => (key === "logger" ? logger : options.db || {}),
    },
  } as any
}

describe("marketing SMS webhook routes", () => {
  const savedEnv = { ...process.env }
  const accountSid = `AC${"a".repeat(32)}`
  const serviceSid = `MG${"b".repeat(32)}`
  const messageSid = `SM${"c".repeat(32)}`
  const inboundUrl = "https://example.com/webhooks/twilio/sms"
  const statusBaseUrl = "https://example.com/webhooks/twilio/sms/status"

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = accountSid
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token"
    process.env.TWILIO_MESSAGING_FROM = "+18447485332"
    process.env.TWILIO_MARKETING_MESSAGING_SERVICE_SID = serviceSid
    process.env.TWILIO_SMS_WEBHOOK_URL = inboundUrl
    process.env.TWILIO_MARKETING_STATUS_WEBHOOK_URL = statusBaseUrl
    process.env.TWILIO_TRANSACTIONAL_FROM = "+18335747455"
    process.env.TWILIO_TRANSACTIONAL_MESSAGING_SERVICE_SID = `MG${"d".repeat(
      32
    )}`
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  function inboundBody(overrides: Record<string, string> = {}) {
    return {
      AccountSid: accountSid,
      MessagingServiceSid: serviceSid,
      To: "+18447485332",
      From: "+14045550100",
      Body: "STOP",
      MessageSid: messageSid,
      ...overrides,
    }
  }

  it("persists managed STOP and returns empty TwiML because Twilio owns the reply", async () => {
    ;(applyInboundSmsConsentChange as jest.Mock).mockResolvedValue({ updated: 1 })
    const body = inboundBody({ Body: "surprising", OptOutType: "STOP" })
    const req = makeReq(body, {
      db: {},
      signature: twilioSignature("test_auth_token", inboundUrl, body),
    })
    const res = makeRes()

    await inboundPost(req, res)

    expect(applyInboundSmsConsentChange).toHaveBeenCalledWith(
      {},
      "+14045550100",
      "stop",
      { messageSid }
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )
  })

  it("returns empty TwiML for carrier-owned raw STOP and managed HELP", async () => {
    ;(applyInboundSmsConsentChange as jest.Mock).mockResolvedValue({ updated: 1 })
    const stopBody = inboundBody()
    const stopRes = makeRes()
    await inboundPost(
      makeReq(stopBody, {
        db: {},
        signature: twilioSignature("test_auth_token", inboundUrl, stopBody),
      }),
      stopRes
    )
    expect(stopRes.send).toHaveBeenCalledWith(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )

    const helpBody = inboundBody({ Body: "HELP", OptOutType: "HELP" })
    const helpRes = makeRes()
    await inboundPost(
      makeReq(helpBody, {
        signature: twilioSignature("test_auth_token", inboundUrl, helpBody),
      }),
      helpRes
    )
    expect(helpRes.send).toHaveBeenCalledWith(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )
  })

  it("returns 500 so Twilio retries when a verified STOP cannot persist", async () => {
    ;(applyInboundSmsConsentChange as jest.Mock).mockRejectedValue(
      new Error("database unavailable")
    )
    const body = inboundBody()
    const req = makeReq(body, {
      db: {},
      signature: twilioSignature("test_auth_token", inboundUrl, body),
    })
    const res = makeRes()

    await inboundPost(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it("returns no second START reply when prior written consent cannot be restored", async () => {
    ;(applyInboundSmsConsentChange as jest.Mock).mockResolvedValue({
      updated: 0,
      nonRestorationReason: "no_qualifying_prior_opt_in",
    })
    const body = inboundBody({ Body: "START", OptOutType: "START" })
    const res = makeRes()

    await inboundPost(
      makeReq(body, {
        db: {},
        signature: twilioSignature("test_auth_token", inboundUrl, body),
      }),
      res
    )

    expect(applyInboundSmsConsentChange).toHaveBeenCalledWith(
      {},
      "+14045550100",
      "start",
      { messageSid }
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    )
  })

  it("prefers OptOutType but never treats YES as toll-free re-opt-in", () => {
    expect(
      marketingInboundClassificationInput({ Body: "HELP", OptOutType: "STOP" })
    ).toBe("stop")
    expect(
      marketingInboundClassificationInput({ Body: "YES", OptOutType: "START" })
    ).toBe("YES")
    expect(
      marketingKeywordReplyOwnedByTwilio(
        { Body: "HELP", OptOutType: "HELP" },
        "help"
      )
    ).toBe(true)
  })

  it("accepts an exact signed delivery callback and rejects the wrong service", async () => {
    ;(applyMarketingSmsStatus as jest.Mock).mockResolvedValue({
      found: true,
      updated: true,
      status: "delivered",
    })
    const messageLogId = "gpmsg_marketing0001"
    const statusUrl = `${statusBaseUrl}?gp_message_id=${messageLogId}`
    const body = {
      AccountSid: accountSid,
      MessagingServiceSid: serviceSid,
      From: "+18447485332",
      To: "+14045550100",
      MessageSid: messageSid,
      MessageStatus: "delivered",
    }
    const res = makeRes()
    await statusPost(
      makeReq(body, {
        db: {},
        query: { gp_message_id: messageLogId },
        signature: twilioSignature("test_auth_token", statusUrl, body),
      }),
      res
    )
    expect(res.status).toHaveBeenCalledWith(204)
    expect(applyMarketingSmsStatus).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        messageLogId,
        messageSid,
        messagingServiceSid: serviceSid,
        messageStatus: "delivered",
      })
    )

    const { MessagingServiceSid: _omitted, ...bodyWithoutService } = body
    const noServiceRes = makeRes()
    await statusPost(
      makeReq(bodyWithoutService, {
        db: {},
        query: { gp_message_id: messageLogId },
        signature: twilioSignature(
          "test_auth_token",
          statusUrl,
          bodyWithoutService
        ),
      }),
      noServiceRes
    )
    expect(noServiceRes.status).toHaveBeenCalledWith(204)
    expect(applyMarketingSmsStatus).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({
        messageLogId,
        messageSid,
        messagingServiceSid: "",
      })
    )

    const wrongServiceBody = {
      ...body,
      MessagingServiceSid: `MG${"z".repeat(32)}`,
    }
    const wrongServiceRes = makeRes()
    await statusPost(
      makeReq(wrongServiceBody, {
        query: { gp_message_id: messageLogId },
        signature: twilioSignature(
          "test_auth_token",
          statusUrl,
          wrongServiceBody
        ),
      }),
      wrongServiceRes
    )
    expect(wrongServiceRes.status).toHaveBeenCalledWith(401)
  })
})
