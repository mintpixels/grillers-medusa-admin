import crypto from "crypto"
import {
  canRestoreSmsMarketingConsentByKeyword,
  classifyInboundSms,
  isInSmsQuietHours,
  resolveSmsPurpose,
  smsWebOptInRequiredReply,
  sendTrackedSms,
  toE164,
  validateSmsMarketingContent,
  verifyTwilioSignature,
} from "../communications/sms"
import {
  SMS_MARKETING_CONSENT_METHOD,
  SMS_MARKETING_CONSENT_PURPOSE,
  SMS_MARKETING_CONSENT_VERSION,
  SMS_MARKETING_DISCLOSURE,
  SMS_MARKETING_PROGRAM,
  SMS_MARKETING_PROVIDER,
} from "../communications/core"

jest.mock("../communications/destinations", () => ({
  writeEventDestinations: jest.fn(async () => undefined),
}))

jest.mock("../communications/queue", () => ({
  enqueueCommunicationEvent: jest.fn(async () => true),
}))

function fakeSmsDb(profile: Record<string, any>) {
  const writes: Array<{ table: string; data: any }> = []
  const db: any = (table: string) => {
    const chain: any = { _write: false }
    for (const method of [
      "whereNull",
      "where",
      "whereIn",
      "whereRaw",
      "select",
      "onConflict",
      "ignore",
    ]) {
      chain[method] = () => chain
    }
    chain.first = async () =>
      table === "gp_customer_profile" ? profile : undefined
    chain.insert = (data: any) => {
      chain._write = true
      writes.push({ table, data })
      return chain
    }
    chain.update = (data: any) => {
      chain._write = true
      writes.push({ table, data })
      return chain
    }
    chain.then = (resolve: (value: any) => void) =>
      Promise.resolve(
        chain._write
          ? []
          : table === "gp_customer_profile"
            ? [profile]
            : []
      ).then(resolve)
    return chain
  }
  db.raw = (sql: string) => sql
  return { db, writes }
}

function v3ConsentMetadata(overrides: Record<string, any> = {}) {
  return {
    sms_consent_at: "2026-07-10T12:00:00.000Z",
    sms_consent_source: "account_signup",
    sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
    sms_consent_text: SMS_MARKETING_DISCLOSURE,
    sms_consent_phone: "4045550100",
    sms_consent_provider: SMS_MARKETING_PROVIDER,
    sms_program: SMS_MARKETING_PROGRAM,
    sms_consent_purpose: SMS_MARKETING_CONSENT_PURPOSE,
    sms_consent_method: SMS_MARKETING_CONSENT_METHOD,
    ...overrides,
  }
}

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
    expect(help.reply).toContain("marketing")
    expect(help.reply).not.toMatch(/order|delivery|shipping/i)
  })

  it("ignores ordinary replies", () => {
    expect(classifyInboundSms("Thanks! See you Friday").action).toBe("none")
    expect(classifyInboundSms("").action).toBe("none")
  })
})

describe("marketing-only SMS policy", () => {
  it("uses semantic purpose rather than physical stream", () => {
    expect(resolveSmsPurpose("transactional", "marketing_1to1")).toBe(
      "marketing_1to1"
    )
    expect(resolveSmsPurpose("broadcast")).toBe("broadcast")
    expect(resolveSmsPurpose("transactional")).toBe("transactional")
  })

  it("rejects use-case drift and incomplete marketing copy", () => {
    expect(
      validateSmsMarketingContent(
        "Griller's Pride holiday specials. Reply STOP to unsubscribe."
      )
    ).toBeNull()
    expect(
      validateSmsMarketingContent(
        "Griller's Pride: your order is ready. Reply STOP to unsubscribe."
      )
    ).toBe("sms_use_case_mismatch")
    expect(validateSmsMarketingContent("Holiday specials. Reply STOP.")).toBe(
      "sms_brand_missing"
    )
    expect(validateSmsMarketingContent("Griller's Pride holiday specials.")).toBe(
      "sms_opt_out_instruction_missing"
    )
  })

  it("lets START restore only a prior qualifying v3 customer opt-in", () => {
    const profile = {
      phone: "4045550100",
      sms_consent: false,
      sms_consent_at: null,
      metadata: v3ConsentMetadata(),
    }
    expect(
      canRestoreSmsMarketingConsentByKeyword(profile, "+14045550100")
    ).toBe(true)
    expect(
      canRestoreSmsMarketingConsentByKeyword(
        {
          ...profile,
          metadata: v3ConsentMetadata({
            sms_consent_version: "sms-v2-2026-07-09",
          }),
        },
        "+14045550100"
      )
    ).toBe(false)
    expect(
      canRestoreSmsMarketingConsentByKeyword(
        {
          ...profile,
          metadata: v3ConsentMetadata({
            sms_consent_source: "staff_phone_order",
          }),
        },
        "+14045550100"
      )
    ).toBe(false)
    expect(smsWebOptInRequiredReply()).toContain(
      "unchecked marketing-text checkbox"
    )
    expect(smsWebOptInRequiredReply()).not.toContain("preferences")
  })

  it("does not let a staff test bypass qualified v3 consent", async () => {
    const legacyProfile = {
      id: "gpcprof_legacy",
      email: "staff@example.com",
      email_lower: "staff@example.com",
      phone: "4045550100",
      sms_consent: true,
      sms_consent_at: "2026-07-09T12:00:00.000Z",
      metadata: v3ConsentMetadata({
        sms_consent_version: "sms-v2-2026-07-09",
      }),
    }
    const { db, writes } = fakeSmsDb(legacyProfile)
    const container = { resolve: () => db } as any

    const result = await sendTrackedSms(container, {
      to: "+14045550100",
      body: "Griller's Pride holiday specials. Reply STOP to unsubscribe.",
      stream: "broadcast",
      purpose: "broadcast",
      template_key: "campaign-sms-test",
      profile_id: legacyProfile.id,
      staff_test: true,
    })

    expect(result).toEqual({ ok: true, skipped: true })
    expect(
      writes.find((write) => write.table === "gp_communication_event")?.data
        ?.properties?.reason
    ).toBe("missing_qualified_sms_marketing_consent")
    expect(
      writes.find((write) => write.table === "gp_message_log")
    ).toBeUndefined()
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
