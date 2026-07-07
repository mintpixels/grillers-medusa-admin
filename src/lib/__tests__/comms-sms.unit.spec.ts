import crypto from "crypto"
import {
  classifyInboundSms,
  isInSmsQuietHours,
  toE164,
  verifyTwilioSignature,
} from "../communications/sms"

describe("sms inbound classification", () => {
  it("recognizes the carrier STOP words", () => {
    for (const word of ["STOP", "stop", "Unsubscribe", "CANCEL", "end", "QUIT"]) {
      expect(classifyInboundSms(word).action).toBe("stop")
    }
  })

  it("recognizes START/UNSTOP", () => {
    expect(classifyInboundSms("START").action).toBe("start")
    expect(classifyInboundSms("unstop").action).toBe("start")
  })

  it("answers HELP with contact info", () => {
    const help = classifyInboundSms("help")
    expect(help.action).toBe("help")
    expect(help.reply).toContain("STOP")
    expect(help.reply).toContain("(770) 454-8108")
  })

  it("ignores ordinary replies", () => {
    expect(classifyInboundSms("Thanks! See you Friday").action).toBe("none")
    expect(classifyInboundSms("").action).toBe("none")
  })
})

describe("toE164", () => {
  it("normalizes 10-digit and 1-prefixed forms", () => {
    expect(toE164("(404) 643-1567")).toBe("+14046431567")
    expect(toE164("1 404 643 1567")).toBe("+14046431567")
    expect(toE164("+14046431567")).toBe("+14046431567")
  })

  it("rejects short/invalid numbers", () => {
    expect(toE164("40464315")).toBeNull()
    expect(toE164("")).toBeNull()
    expect(toE164(null)).toBeNull()
  })
})

describe("sms quiet hours (America/New_York)", () => {
  const prevStart = process.env.COMMS_SMS_QUIET_START
  const prevEnd = process.env.COMMS_SMS_QUIET_END
  afterEach(() => {
    process.env.COMMS_SMS_QUIET_START = prevStart
    process.env.COMMS_SMS_QUIET_END = prevEnd
  })

  it("blocks 7am ET and allows 10am ET (summer)", () => {
    delete process.env.COMMS_SMS_QUIET_START
    delete process.env.COMMS_SMS_QUIET_END
    // 2026-07-14: EDT (UTC-4). 07:00 ET = 11:00Z; 10:00 ET = 14:00Z.
    expect(isInSmsQuietHours(new Date("2026-07-14T11:00:00Z"))).toBe(true)
    expect(isInSmsQuietHours(new Date("2026-07-14T14:00:00Z"))).toBe(false)
  })

  it("blocks 9pm ET (past the 20:30 cutoff), winter too", () => {
    // 2026-12-15: EST (UTC-5). 21:00 ET = 02:00Z next day.
    expect(isInSmsQuietHours(new Date("2026-12-16T02:00:00Z"))).toBe(true)
    // 12:00 ET = 17:00Z — allowed.
    expect(isInSmsQuietHours(new Date("2026-12-15T17:00:00Z"))).toBe(false)
  })
})

describe("twilio signature verification", () => {
  const prevToken = process.env.TWILIO_AUTH_TOKEN
  afterEach(() => {
    process.env.TWILIO_AUTH_TOKEN = prevToken
  })

  it("accepts a correctly signed request and rejects a tampered one", () => {
    process.env.TWILIO_AUTH_TOKEN = "test_token_123"
    const url = "https://example.com/webhooks/twilio/sms"
    const params = { Body: "STOP", From: "+14046431567" }
    const data =
      url +
      Object.keys(params)
        .sort()
        .map((k) => `${k}${(params as any)[k]}`)
        .join("")
    const signature = crypto
      .createHmac("sha1", "test_token_123")
      .update(Buffer.from(data, "utf-8"))
      .digest("base64")

    expect(verifyTwilioSignature({ signature, url, params })).toBe(true)
    expect(
      verifyTwilioSignature({
        signature,
        url,
        params: { ...params, Body: "START" },
      })
    ).toBe(false)
    expect(verifyTwilioSignature({ signature: "", url, params })).toBe(false)
  })

  it("fails open only when no auth token is configured (local dev)", () => {
    delete process.env.TWILIO_AUTH_TOKEN
    expect(
      verifyTwilioSignature({ signature: "", url: "http://x", params: {} })
    ).toBe(true)
  })
})
