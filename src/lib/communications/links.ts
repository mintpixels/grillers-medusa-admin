import crypto from "crypto"

/**
 * Marketing-email link instrumentation: every http(s) link gets UTM
 * parameters and is wrapped in a signed redirect through the backend so
 * clicks land in gp_link_click (which also powers last-click attribution).
 * Unsubscribe/preference/mailto/anchor links are left untouched.
 */

const SKIP_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^#/,
  /pm:unsubscribe/i,
  /\/preferences\//i,
  /\{\{/, // unresolved merge tags
]

function linkSecret() {
  return (
    process.env.COMMS_LINK_SECRET ||
    process.env.TWILIO_AUTH_TOKEN ||
    process.env.POSTMARK_WEBHOOK_SECRET ||
    ""
  )
}

export function signLinkToken(messageId: string, index: number): string {
  const secret = linkSecret()
  return crypto
    .createHmac("sha256", secret)
    .update(`${messageId}:${index}`)
    .digest("base64url")
    .slice(0, 16)
}

export function verifyLinkToken(
  messageId: string,
  index: number,
  sig: string
): boolean {
  if (!linkSecret()) return false
  const expected = signLinkToken(messageId, index)
  const a = Buffer.from(expected)
  const b = Buffer.from(String(sig || ""))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function addUtmParams(
  url: string,
  utm: { source?: string; medium?: string; campaign?: string; content?: string }
): string {
  try {
    const parsed = new URL(url)
    if (!parsed.searchParams.has("utm_source")) {
      parsed.searchParams.set("utm_source", utm.source || "gp-comms")
    }
    if (!parsed.searchParams.has("utm_medium")) {
      parsed.searchParams.set("utm_medium", utm.medium || "email")
    }
    if (utm.campaign && !parsed.searchParams.has("utm_campaign")) {
      parsed.searchParams.set("utm_campaign", utm.campaign)
    }
    if (utm.content && !parsed.searchParams.has("utm_content")) {
      parsed.searchParams.set("utm_content", utm.content)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export type InstrumentedEmail = {
  html: string
  /** Original (post-UTM) destinations by index — persisted on the message row. */
  links: string[]
}

/**
 * Rewrite <a href="http(s)://..."> targets: UTM-tag the destination, then
 * wrap it in `${base}/l/${messageId}/${index}/${sig}`. Skips unsubscribe,
 * preference, mailto, tel, anchors, and unresolved merge tags. Falls back
 * to UTM-only when no signing secret or public base URL is configured.
 */
export function instrumentEmailHtml(
  html: string,
  input: {
    messageId: string
    backendBaseUrl?: string | null
    utm: { campaign?: string; content?: string; medium?: string }
  }
): InstrumentedEmail {
  const links: string[] = []
  const base = String(input.backendBaseUrl || "").replace(/\/$/, "")
  const canWrap = Boolean(base && linkSecret())

  const rewritten = html.replace(
    /(<a\b[^>]*?href=)(["'])(https?:\/\/[^"']+)\2/gi,
    (match, prefix, quote, url) => {
      if (SKIP_PATTERNS.some((pattern) => pattern.test(url))) return match
      const tagged = addUtmParams(url, {
        source: "gp-comms",
        medium: input.utm.medium || "email",
        campaign: input.utm.campaign,
        content: input.utm.content,
      })
      if (!canWrap) return `${prefix}${quote}${tagged}${quote}`
      const index = links.length
      links.push(tagged)
      const sig = signLinkToken(input.messageId, index)
      return `${prefix}${quote}${base}/l/${encodeURIComponent(input.messageId)}/${index}/${sig}${quote}`
    }
  )

  return { html: rewritten, links }
}
