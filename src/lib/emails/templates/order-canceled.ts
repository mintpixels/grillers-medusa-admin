import { renderEmail, renderTextFromLines, STOREFRONT_URL, SUPPORT_EMAIL } from "../layout"
import { formatMoney, renderItemRows, escapeHtml } from "../components"
import { type OrderForEmail } from "../order-fetch"

export const buildOrderCanceledEmail = ({
  order,
  reason,
}: {
  order: OrderForEmail
  reason?: string
}) => {
  const display = order.display_id ? `#${order.display_id}` : ""
  const currency = (order.currency_code || "USD").toUpperCase()
  const orderUrl = `${STOREFRONT_URL}/us/order/${order.id}/confirmed`

  const bodyHtml = `
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      Your order${display ? ` <strong>${escapeHtml(display)}</strong>` : ""} has been canceled. Any pending authorization on your card will be released — most banks reflect the release within 1–5 business days.
    </p>
    ${reason ? `<div style="background:#F0F0ED;border-left:4px solid #951D20;padding:14px 18px;border-radius:4px;margin:20px 0;font-size:14px;color:#2A2828;"><strong>Reason:</strong> ${escapeHtml(reason)}</div>` : ""}
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin:24px 0 12px 0;">Canceled items</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${renderItemRows(order.items, currency)}</table>
    <p style="margin:28px 0 0 0;font-size:14px;line-height:1.6;color:#2A2828;">
      If this cancellation was a mistake, reach out to us right away at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and we'll help sort it out.
    </p>`

  const { html } = renderEmail({
    preheader: `Order${display ? " " + display : ""} canceled. Authorization release pending.`,
    eyebrow: "Order canceled",
    heading: display ? `Order ${display} canceled` : "Order canceled",
    intro: "We're sorry for the inconvenience.",
    bodyHtml,
    ctaUrl: orderUrl,
    ctaLabel: "View order",
    footerNote: `Need help? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`,
  })

  const text = renderTextFromLines([
    `Order canceled${display ? " " + display : ""}`,
    "",
    "Your order has been canceled. Any pending authorization will be released within 1–5 business days.",
    reason ? `Reason: ${reason}` : "",
    "",
    "Items:",
    ...(order.items?.map(
      (i) =>
        `  ${i.quantity} x ${i.title} — ${formatMoney((i.unit_price || 0) * (i.quantity || 0), currency)}`
    ) || []),
    "",
    `Need help? ${SUPPORT_EMAIL}`,
  ])

  return {
    subject: `Order canceled${display ? " " + display : ""} — Griller's Pride`,
    html,
    text,
  }
}
