import { buildSimpleMessageEmail } from "../emails/templates/simple-message"
import {
  MARKETING_SUPPRESSION_SCOPES,
  SMS_MARKETING_CONSENT_METHOD,
  SMS_MARKETING_CONSENT_PURPOSE,
  SMS_MARKETING_CONSENT_VERSION,
  SMS_MARKETING_DISCLOSURE,
  SMS_MARKETING_PROGRAM,
  SMS_MARKETING_PROVIDER,
  hasQualifyingSmsMarketingConsent,
  isStaleSmsConsentReplay,
  normalizeEmail,
  postmarkMetadata,
  preferenceUrl,
  smsConsentFromCustomerMetadata,
  verifyServiceApiKey,
  withoutSmsConsentEvidence,
} from "../communications/core"
import { queuesConfigured } from "../communications/queue"
import { resolveFlowMessagePurpose } from "../communications/flows"
import { COMMUNICATION_TEMPLATE_REGISTRY } from "../communications/templates"

describe("communications helpers", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.STOREFRONT_URL = "https://grillerspride.com"
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("normalizes profile email addresses consistently", () => {
    expect(normalizeEmail("  Avi@Example.COM ")).toBe("avi@example.com")
    expect(normalizeEmail(null)).toBe("")
  })

  it("maps only exact customer-originated v3 marketing evidence onto profiles", () => {
    expect(SMS_MARKETING_DISCLOSURE).toBe(
      "By checking this box, I agree to receive recurring automated marketing and promotional text messages from Griller's Pride, including seasonal specials, product announcements, promotional offers, and holiday sales deadlines, at the mobile number provided. Consent is not a condition of purchase. Message frequency varies, up to 6 messages per month. Msg & data rates may apply. Reply STOP to opt out or HELP for help."
    )
    const metadata = {
      sms_marketing_opt_in: true,
      sms_consent_at: "2026-07-10T12:00:00.000Z",
      sms_consent_source: "account_signup",
      sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
      sms_consent_text: SMS_MARKETING_DISCLOSURE,
      sms_consent_phone: "4045550100",
      sms_consent_provider: SMS_MARKETING_PROVIDER,
      sms_program: SMS_MARKETING_PROGRAM,
      sms_consent_purpose: SMS_MARKETING_CONSENT_PURPOSE,
      sms_consent_method: SMS_MARKETING_CONSENT_METHOD,
    }
    const mapped = smsConsentFromCustomerMetadata(metadata)
    expect(mapped).toEqual({
      sms_consent: true,
      sms_consent_at: "2026-07-10T12:00:00.000Z",
      metadata: {
        sms_consent_at: "2026-07-10T12:00:00.000Z",
        sms_consent_source: "account_signup",
        sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
        sms_consent_text: SMS_MARKETING_DISCLOSURE,
        sms_consent_phone: "4045550100",
        sms_consent_provider: SMS_MARKETING_PROVIDER,
        sms_program: SMS_MARKETING_PROGRAM,
        sms_consent_purpose: SMS_MARKETING_CONSENT_PURPOSE,
        sms_consent_method: SMS_MARKETING_CONSENT_METHOD,
      },
    })
    expect(
      hasQualifyingSmsMarketingConsent(
        { phone: "(404) 555-0100", ...mapped },
        "+14045550100"
      )
    ).toBe(true)

    expect(smsConsentFromCustomerMetadata({})).toEqual({})
  })

  it("quarantines legacy, mixed, staff-attested, and wrong-number SMS evidence", () => {
    const valid = {
      sms_marketing_opt_in: true,
      sms_consent_at: "2026-07-10T12:00:00.000Z",
      sms_consent_source: "account_signup",
      sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
      sms_consent_text: SMS_MARKETING_DISCLOSURE,
      sms_consent_phone: "4045550100",
      sms_consent_provider: SMS_MARKETING_PROVIDER,
      sms_program: SMS_MARKETING_PROGRAM,
      sms_consent_purpose: SMS_MARKETING_CONSENT_PURPOSE,
      sms_consent_method: SMS_MARKETING_CONSENT_METHOD,
    }

    expect(
      smsConsentFromCustomerMetadata({
        ...valid,
        sms_consent_version: "sms-v2-2026-07-09",
      })
    ).toEqual({})
    expect(
      smsConsentFromCustomerMetadata({
        ...valid,
        sms_consent_source: "staff_phone_order",
      })
    ).toEqual({})
    expect(
      smsConsentFromCustomerMetadata({
        ...valid,
        sms_consent_text: `${SMS_MARKETING_DISCLOSURE} Order updates too.`,
      })
    ).toEqual({})

    const mapped = smsConsentFromCustomerMetadata(valid)
    expect(
      hasQualifyingSmsMarketingConsent(
        { phone: "4045559999", ...mapped },
        "+14045559999"
      )
    ).toBe(false)
  })

  it("keeps STOP durable against stale customer metadata replays", () => {
    expect(
      isStaleSmsConsentReplay(
        "2026-07-10T12:00:00.000Z",
        "2026-07-11T12:00:00.000Z",
        false
      )
    ).toBe(true)
    expect(
      isStaleSmsConsentReplay(
        "2026-07-12T12:00:00.000Z",
        "2026-07-11T12:00:00.000Z",
        false
      )
    ).toBe(false)
    // A profile legitimately restored by START remains active when the old
    // Medusa metadata is observed again.
    expect(
      isStaleSmsConsentReplay(
        "2026-07-10T12:00:00.000Z",
        "2026-07-11T12:00:00.000Z",
        true
      )
    ).toBe(false)
  })

  it("does not trust public identify traits as SMS consent evidence", () => {
    expect(
      withoutSmsConsentEvidence({
        email: "customer@example.com",
        favorite_cut: "brisket",
        sms_marketing_opt_in: true,
        sms_consent: true,
        sms_consent_at: "2026-07-10T12:00:00.000Z",
        sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
      })
    ).toEqual({
      email: "customer@example.com",
      favorite_cut: "brisket",
    })
  })

  it("caps Postmark metadata at the provider limit without empty fields", () => {
    const metadata = postmarkMetadata({
      message_log_id: "gpmsg_1",
      template_key: "order-placed",
      stream: "transactional",
      purpose: "transactional",
      order_id: "order_1",
      cart_id: "",
      campaign_id: null,
      flow_id: undefined,
      email: "avi@example.com",
      total: 42.45,
      display_id: 102,
      extra_1: "kept",
      preference_center_url: "https://grillerspride.com/prefs",
      extra_2: "dropped",
      nested: { too: "late" },
    })

    expect(Object.keys(metadata)).toHaveLength(10)
    expect(Object.keys(metadata).every((key) => key.length <= 20)).toBe(true)
    expect(metadata.cart_id).toBeUndefined()
    expect(metadata.campaign_id).toBeUndefined()
    expect(metadata.flow_id).toBeUndefined()
    expect(metadata.total).toBe("42.45")
    expect(metadata.extra_1).toBe("kept")
    expect(metadata.preference_center_ur).toBe("https://grillerspride.com/prefs")
    expect(metadata.extra_2).toBeUndefined()
    expect(metadata.nested).toBeUndefined()
  })

  it("renders lifecycle emails with absolute storefront links", () => {
    const email = buildSimpleMessageEmail({
      subject: "Your cart is still here",
      heading: "Your cart is still here",
      paragraphs: ["Inventory can change, so check out while items are available."],
      ctaLabel: "Return to cart",
      ctaUrl: "/us/cart",
    })

    expect(email.html).toMatch(/href="https?:\/\/[^"]+\/us\/cart"/)
    expect(email.text).toMatch(/Return to cart: https?:\/\/.+\/us\/cart/)
    expect(email.html).toContain("/images/logos/logo-horizontal.png")
  })

  it("builds preference-center links from the configured storefront origin", () => {
    expect(preferenceUrl("pref-token")).toBe(
      "https://grillerspride.com/us/email-preferences?t=pref-token"
    )
  })

  it("accepts a separate public communications ingestion key", () => {
    process.env.NEWSLETTER_API_KEY = "private-newsletter-key"
    process.env.COMMUNICATIONS_PUBLIC_API_KEY = "public-ingestion-key"

    expect(
      verifyServiceApiKey({ "x-api-key": "public-ingestion-key" })
    ).toBe(true)
    expect(
      verifyServiceApiKey({ authorization: "Bearer private-newsletter-key" })
    ).toBe(true)
    expect(verifyServiceApiKey({ "x-api-key": "wrong-key" })).toBe(false)
  })

  it("keeps separate template coverage for transactional lifecycle and broadcast streams", () => {
    const streams = new Set(
      COMMUNICATION_TEMPLATE_REGISTRY.map((template) => template.stream)
    )
    expect(streams.has("transactional")).toBe(true)
    expect(streams.has("lifecycle")).toBe(true)
    expect(streams.has("broadcast")).toBe(true)
    expect(
      COMMUNICATION_TEMPLATE_REGISTRY.some(
        (template) => template.key === "refund-issued"
      )
    ).toBe(true)
    expect(
      COMMUNICATION_TEMPLATE_REGISTRY.some(
        (template) => template.key === "back-in-stock"
      )
    ).toBe(true)
  })

  it("routes one-to-one cart recovery through transactional Postmark with marketing consent semantics", () => {
    const cartTemplates = COMMUNICATION_TEMPLATE_REGISTRY.filter((template) =>
      template.key.startsWith("cart-abandoned")
    )

    expect(cartTemplates.length).toBeGreaterThan(0)
    expect(cartTemplates.every((template) => template.stream === "transactional")).toBe(
      true
    )
    expect(
      cartTemplates.every((template) => template.purpose === "marketing_1to1")
    ).toBe(true)
  })

  it("passes the flow-level marketing purpose to SMS/email steps", () => {
    expect(
      resolveFlowMessagePurpose(
        undefined,
        "marketing_1to1",
        "transactional"
      )
    ).toBe("marketing_1to1")
    expect(
      resolveFlowMessagePurpose("broadcast", "marketing_1to1", "lifecycle")
    ).toBe("broadcast")
  })

  it("resubscribe paths clear every marketing suppression scope", () => {
    expect(MARKETING_SUPPRESSION_SCOPES).toEqual([
      "marketing",
      "lifecycle",
      "broadcast",
      "marketing_1to1",
    ])
  })

  it("treats communications queues as optional infrastructure", () => {
    delete process.env.REDIS_URL
    delete process.env.COMMUNICATIONS_REDIS_URL
    expect(queuesConfigured()).toBe(false)

    process.env.COMMUNICATIONS_REDIS_URL = "redis://localhost:6379"
    expect(queuesConfigured()).toBe(true)
  })
})
