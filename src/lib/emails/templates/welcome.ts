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
      A quick note on how we work: most cuts are sold by the pound, so we use <strong>catch-weight pricing</strong>. Your card is saved at checkout, then we weigh and charge the actual amount before the order leaves. You only pay for what you get.
    </p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;width:100%;">
      <tr>
        <td style="background:#FBFAF6;border:1px solid #E4DED2;padding:18px 20px;border-radius:6px;">
          <div style="font-size:11px;letter-spacing:0;text-transform:uppercase;color:#8B5E2D;font-weight:700;margin-bottom:8px;">Your account</div>
          <div style="font-size:14px;color:#17201A;">${escapeHtml(email)}</div>
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
    "We use catch-weight pricing: your card is saved at checkout, then we weigh and charge the actual amount before the order leaves.",
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
