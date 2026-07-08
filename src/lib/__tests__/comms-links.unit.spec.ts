import {
  addUtmParams,
  instrumentEmailHtml,
  signLinkToken,
  verifyLinkToken,
} from "../communications/links"

describe("link instrumentation", () => {
  const OLD_SECRET = process.env.COMMS_LINK_SECRET
  beforeAll(() => {
    process.env.COMMS_LINK_SECRET = "test-secret"
  })
  afterAll(() => {
    process.env.COMMS_LINK_SECRET = OLD_SECRET
  })

  it("adds UTM params without clobbering existing ones", () => {
    const url = addUtmParams("https://x.com/p?utm_source=partner", {
      source: "gp-comms",
      medium: "email",
      campaign: "camp1",
    })
    const parsed = new URL(url)
    expect(parsed.searchParams.get("utm_source")).toBe("partner")
    expect(parsed.searchParams.get("utm_medium")).toBe("email")
    expect(parsed.searchParams.get("utm_campaign")).toBe("camp1")
  })

  it("wraps http links in signed redirects and stores originals", () => {
    const html =
      '<a href="https://getgrillerspride.com/store">Shop</a> ' +
      '<a href="mailto:hi@x.com">mail</a> ' +
      '<a href="{{{ pm:unsubscribe }}}">Unsubscribe</a> ' +
      '<a href="https://x.com/us/preferences/tok123">Prefs</a>'
    const { html: out, links } = instrumentEmailHtml(html, {
      messageId: "gpmsg_1",
      backendBaseUrl: "https://api.example.com",
      utm: { campaign: "c1", content: "t1" },
    })
    expect(links).toHaveLength(1)
    expect(links[0]).toContain("utm_source=gp-comms")
    expect(out).toContain("https://api.example.com/l/gpmsg_1/0/")
    // untouched: mailto, unsubscribe merge tag, preference link
    expect(out).toContain('href="mailto:hi@x.com"')
    expect(out).toContain("pm:unsubscribe")
    expect(out).toContain("/us/preferences/tok123")
  })

  it("falls back to UTM-only when no backend base is configured", () => {
    const { html: out, links } = instrumentEmailHtml(
      '<a href="https://x.com/a">A</a>',
      { messageId: "gpmsg_2", backendBaseUrl: "", utm: {} }
    )
    expect(links).toHaveLength(0)
    expect(out).toContain("utm_source=gp-comms")
    expect(out).not.toContain("/l/")
  })

  it("verifies only correctly signed tokens", () => {
    const sig = signLinkToken("gpmsg_9", 3)
    expect(verifyLinkToken("gpmsg_9", 3, sig)).toBe(true)
    expect(verifyLinkToken("gpmsg_9", 4, sig)).toBe(false)
    expect(verifyLinkToken("gpmsg_8", 3, sig)).toBe(false)
    expect(verifyLinkToken("gpmsg_9", 3, "forged-sig-here")).toBe(false)
  })
})
