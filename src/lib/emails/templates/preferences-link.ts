import { renderEmail, renderTextFromLines } from "../layout"
import { escapeHtml } from "../components"

export function buildPreferencesLinkEmail({
  email,
  preferencesUrl,
}: {
  email: string
  preferencesUrl: string
}) {
  const bodyHtml = `
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#2A2828;">
      Use this private link to manage Griller's Pride email preferences for
      <strong>${escapeHtml(email)}</strong>.
    </p>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#6F665B;">
      If you did not request this, you can ignore this email.
    </p>`

  const { html } = renderEmail({
    preheader: "Manage your Griller's Pride email preferences.",
    eyebrow: "Email preferences",
    heading: "Your preferences link",
    intro: "Choose which Griller's Pride emails you want to receive.",
    bodyHtml,
    ctaUrl: preferencesUrl,
    ctaLabel: "Manage preferences",
  })

  const text = renderTextFromLines([
    "Your Griller's Pride email preferences link",
    "",
    `Email: ${email}`,
    `Manage preferences: ${preferencesUrl}`,
    "",
    "If you did not request this, you can ignore this email.",
  ])

  return {
    subject: "Manage your Griller's Pride email preferences",
    html,
    text,
  }
}
