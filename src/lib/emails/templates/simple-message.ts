import { renderEmail, renderTextFromLines, STOREFRONT_URL } from "../layout"
import { escapeHtml } from "../components"

type SimpleMessageInput = {
  subject: string
  eyebrow?: string
  heading: string
  intro?: string
  paragraphs?: string[]
  ctaLabel?: string
  ctaUrl?: string
  footerNote?: string
}

function absoluteUrl(value?: string) {
  if (!value) return `${STOREFRONT_URL}/us/store`
  if (/^https?:\/\//i.test(value)) return value
  const base = STOREFRONT_URL.replace(/\/+$/, "")
  return `${base}${value.startsWith("/") ? value : `/${value}`}`
}

export function buildSimpleMessageEmail(input: SimpleMessageInput) {
  const ctaUrl = absoluteUrl(input.ctaUrl)
  const ctaLabel = input.ctaLabel || "Shop Griller's Pride"
  const bodyHtml = (input.paragraphs || [])
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#2A2828;">${escapeHtml(paragraph)}</p>`
    )
    .join("")

  const { html } = renderEmail({
    preheader: input.intro || input.heading,
    eyebrow: input.eyebrow || "Griller's Pride",
    heading: input.heading,
    intro: input.intro,
    bodyHtml:
      bodyHtml ||
      `<p style="margin:0;font-size:15px;line-height:1.65;color:#2A2828;">${escapeHtml(input.heading)}</p>`,
    ctaLabel,
    ctaUrl,
    footerNote: input.footerNote,
  })

  const text = renderTextFromLines([
    input.heading,
    "",
    input.intro || "",
    ...(input.paragraphs || []),
    "",
    `${ctaLabel}: ${ctaUrl}`,
  ])

  return { subject: input.subject, html, text }
}
