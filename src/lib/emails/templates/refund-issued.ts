import { renderEmail, renderTextFromLines, STOREFRONT_URL, SUPPORT_EMAIL } from "../layout"
import { formatMoney, renderHighlightCard, escapeHtml } from "../components"
import { type OrderForEmail } from "../order-fetch"

export const buildRefundIssuedEmail = ({
  order,
  refundAmount,
  reason,
}: {
  order: OrderForEmail
  refundAmount: number | string
  reason?: string
}) => {
  const display = order.display_id ? `#${order.display_id}` : ""
  const currency = (order.currency_code || "USD").toUpperCase()
  const orderUrl = `${STOREFRONT_URL}/us/order/${order.id}/confirmed`

  const refundCard = renderHighlightCard({
    label: "Refund issued",
    title: formatMoney(refundAmount, currency),
    subtitle: "Returning to your original payment method.",
    note: "Most banks reflect refunds within 3–10 business days, depending on your card issuer.",
  })

  const bodyHtml = `
    ${refundCard}
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      We've issued a refund of <strong>${formatMoney(refundAmount, currency)}</strong> on order${display ? ` <strong>${escapeHtml(display)}</strong>` : ""}. The funds will return to the same card you used at checkout.
    </p>
    ${reason ? `<div style="background:#F0F0ED;padding:14px 18px;border-radius:4px;margin:20px 0;font-size:14px;color:#2A2828;"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ""}
    <p style="margin:24px 0 0 0;font-size:14px;line-height:1.6;color:#2A2828;">
      Questions about this refund? Reply to this email or contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.
    </p>`

  const { html } = renderEmail({
    preheader: `Refund issued for ${formatMoney(refundAmount, currency)}.`,
    eyebrow: "Refund issued",
    heading: `Refund of ${formatMoney(refundAmount, currency)}`,
    intro: "We've issued a refund on your order.",
    bodyHtml,
    ctaUrl: orderUrl,
    ctaLabel: "View order",
    footerNote: `Refunds typically reflect within 3–10 business days depending on your card issuer.`,
  })

  const text = renderTextFromLines([
    `Refund issued: ${formatMoney(refundAmount, currency)}${display ? " — order " + display : ""}`,
    "",
    "The funds will return to the card you used at checkout, typically within 3–10 business days.",
    reason ? `Reason: ${reason}` : "",
    "",
    `View order: ${orderUrl}`,
  ])

  return {
    subject: `Refund issued${display ? " — order " + display : ""} — Griller's Pride`,
    html,
    text,
  }
}
