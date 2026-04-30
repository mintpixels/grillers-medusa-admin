import { renderEmail, renderTextFromLines, STOREFRONT_URL } from "../layout"
import { escapeHtml } from "../components"

export const buildWelcomeEmail = ({
  email,
  firstName,
}: {
  email: string
  firstName?: string | null
}) => {
  const greetingName = firstName?.trim() || ""
  const greeting = greetingName ? `Welcome, ${greetingName}.` : "Welcome."

  const bodyHtml = `
    <p style="margin:0 0 18px 0;font-size:16px;line-height:1.65;color:#2A2828;">
      Your account is ready. From here you can place orders, track shipments, save addresses for faster checkout, and view your order history any time.
    </p>
    <p style="margin:0 0 22px 0;font-size:15px;line-height:1.65;color:#2A2828;">
      A quick note on how we work: most cuts are sold by the pound, so we use <strong>catch-weight pricing</strong> — your card is authorized for an estimate at checkout, then we weigh and charge the actual amount (within ±15%) the morning your order ships. You only pay for what you get.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;width:100%;">
      <tr>
        <td style="background:#F0F0ED;padding:18px 20px;border-radius:4px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:8px;">Your account</div>
          <div style="font-size:14px;color:#001B23;">${escapeHtml(email)}</div>
        </td>
      </tr>
    </table>`

  const { html } = renderEmail({
    preheader: "Your Griller's Pride account is ready.",
    eyebrow: "Welcome",
    heading: greeting,
    intro: "Thanks for joining Griller's Pride.",
    bodyHtml,
    ctaUrl: `${STOREFRONT_URL}/us/account`,
    ctaLabel: "Go to your account",
    footerNote: `Curious about catch-weight pricing? <a href="${STOREFRONT_URL}/us/page/catch-weight-pricing">Read the explainer →</a>`,
  })

  const text = renderTextFromLines([
    greeting,
    "",
    "Your Griller's Pride account is ready.",
    "",
    "We use catch-weight pricing: your card is authorized at checkout for an estimate, then we weigh and charge the actual amount (within ±15%) when your order ships.",
    "",
    `Account email: ${email}`,
    "",
    `Go to your account: ${STOREFRONT_URL}/us/account`,
  ])

  return {
    subject: "Welcome to Griller's Pride",
    html,
    text,
  }
}
