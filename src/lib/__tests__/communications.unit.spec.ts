import { buildSimpleMessageEmail } from "../emails/templates/simple-message"
import {
  MARKETING_SUPPRESSION_SCOPES,
  normalizeEmail,
  postmarkMetadata,
  preferenceUrl,
  verifyServiceApiKey,
} from "../communications/core"
import { queuesConfigured } from "../communications/queue"
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
