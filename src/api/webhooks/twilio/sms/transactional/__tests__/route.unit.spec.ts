import crypto from "crypto"
import {
  POST as inboundPost,
  transactionalInboundClassificationInput,
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

function makeReq(
  body: Record<string, string>,
  options: { query?: Record<string, string>; signature?: string } = {}
) {
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
  return {
    body,
    headers: {
      "x-twilio-signature": options.signature || "invalid-signature",
    },
    query: options.query || {},
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        throw new Error(`database must not be resolved after bad signature: ${key}`)
      },
    },
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

describe("transactional SMS webhook signature gates", () => {
  const savedEnv = { ...process.env }

  beforeEach(() => {
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token"
    process.env.TWILIO_TRANSACTIONAL_INBOUND_WEBHOOK_URL =
      "https://example.com/webhooks/twilio/sms/transactional"
    process.env.TWILIO_TRANSACTIONAL_STATUS_WEBHOOK_URL =
      "https://example.com/webhooks/twilio/sms/transactional/status"
    process.env.TWILIO_ACCOUNT_SID = `AC${"a".repeat(32)}`
    process.env.TWILIO_TRANSACTIONAL_MESSAGING_SERVICE_SID = `MG${"b".repeat(
      32
    )}`
    process.env.TWILIO_TRANSACTIONAL_FROM = "+18335747455"
    process.env.TWILIO_MESSAGING_FROM = "+18447485332"
  })

  afterEach(() => {
    process.env = { ...savedEnv }
  })

  it("rejects an invalid inbound signature before changing suppression state", async () => {
    const req = makeReq({
      From: "+14045550100",
      Body: "STOP",
      MessageSid: "SM_stop_123",
    })
    const res = makeRes()

    await inboundPost(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith("unauthorized")
  })

  it("rejects an invalid status signature before updating a message log", async () => {
    const req = makeReq({
      MessageSid: "SM_status_123",
      MessageStatus: "delivered",
    })
    const res = makeRes()

    await statusPost(req, res)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith("unauthorized")
  })

  it("rejects a correctly signed inbound webhook for the wrong number", async () => {
    const url = String(process.env.TWILIO_TRANSACTIONAL_INBOUND_WEBHOOK_URL)
    const body = {
      AccountSid: `AC${"a".repeat(32)}`,
      MessagingServiceSid: `MG${"b".repeat(32)}`,
      To: "+18447485332",
      From: "+14045550100",
      Body: "STOP",
      MessageSid: "SM_stop_123",
    }
    const req = makeReq(body, {
      signature: twilioSignature("test_auth_token", url, body),
    })
    const res = makeRes()
    await inboundPost(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith("unauthorized")
  })

  it("signs status callbacks against the exact correlation query and rejects the wrong sender", async () => {
    const messageId = "gpmsg_route0001"
    const url = `${process.env.TWILIO_TRANSACTIONAL_STATUS_WEBHOOK_URL}?gp_message_id=${messageId}`
    const body = {
      AccountSid: `AC${"a".repeat(32)}`,
      MessagingServiceSid: `MG${"b".repeat(32)}`,
      From: "+18447485332",
      To: "+14045550100",
      MessageSid: "SM_status_123",
      MessageStatus: "delivered",
    }
    const req = makeReq(body, {
      query: { gp_message_id: messageId },
      signature: twilioSignature("test_auth_token", url, body),
    })
    const res = makeRes()
    await statusPost(req, res)
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.send).toHaveBeenCalledWith("unauthorized")
  })

  it("prefers managed STOP but refuses YES as toll-free re-opt-in", () => {
    expect(
      transactionalInboundClassificationInput({
        Body: "HELP",
        OptOutType: "STOP",
      })
    ).toBe("stop")
    expect(
      transactionalInboundClassificationInput({
        Body: "YES",
        OptOutType: "START",
      })
    ).toBe("YES")
    expect(
      transactionalInboundClassificationInput({
        Body: "UNSTOP",
        OptOutType: "START",
      })
    ).toBe("unstop")
  })
})
