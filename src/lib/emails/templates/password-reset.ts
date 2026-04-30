import { renderEmail, renderTextFromLines, STOREFRONT_URL, SUPPORT_EMAIL } from "../layout"
import { escapeHtml } from "../components"

export const buildPasswordResetEmail = ({
  email,
  token,
}: {
  email: string
  token: string
}) => {
  const resetUrl =
    `${STOREFRONT_URL}/us/reset-password` +
    `?token=${encodeURIComponent(token)}` +
    `&email=${encodeURIComponent(email)}`

  const bodyHtml = `
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      We received a request to reset the password on your Griller's Pride account. Click the button below to set a new password — this link expires in <strong>15 minutes</strong>.
    </p>
    <p style="margin:24px 0 8px 0;font-size:13px;color:#686674;line-height:1.6;">
      If the button doesn't open, copy and paste this URL into your browser:
    </p>
    <p style="margin:0;font-size:12px;word-break:break-all;color:#2D479D;">
      <a href="${escapeHtml(resetUrl)}" style="color:#2D479D;">${escapeHtml(resetUrl)}</a>
    </p>`

  const { html } = renderEmail({
    preheader: "Reset your Griller's Pride password — link expires in 15 minutes.",
    eyebrow: "Account",
    heading: "Reset your password",
    bodyHtml,
    ctaUrl: resetUrl,
    ctaLabel: "Reset password",
    footerNote: `If you didn't request this, you can safely ignore this email — your password will stay the same. Concerned? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.`,
  })

  const text = renderTextFromLines([
    "Reset your Griller's Pride password",
    "",
    "We received a request to reset your password. The link below expires in 15 minutes:",
    "",
    resetUrl,
    "",
    "If you didn't request this, you can ignore this email.",
    "",
    `Questions? ${SUPPORT_EMAIL}`,
  ])

  return {
    subject: "Reset your Griller's Pride password",
    html,
    text,
  }
}
