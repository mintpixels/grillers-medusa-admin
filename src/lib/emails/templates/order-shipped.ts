import { renderEmail, renderTextFromLines, STOREFRONT_URL } from "../layout"
import { renderHighlightCard, renderItemRows, escapeHtml } from "../components"
import { type OrderForEmail, getFulfillmentInfo } from "../order-fetch"

export const buildOrderShippedEmail = ({
  order,
  trackingNumber,
  trackingUrl,
  carrier,
}: {
  order: OrderForEmail
  trackingNumber?: string
  trackingUrl?: string
  carrier?: string
}) => {
  const display = order.display_id ? `#${order.display_id}` : ""
  const orderUrl = `${STOREFRONT_URL}/us/order/${order.id}/confirmed`
  const currency = (order.currency_code || "USD").toUpperCase()
  const { shippingMethodName } = getFulfillmentInfo(order)
  const carrierLabel = carrier || shippingMethodName || "Carrier"

  const trackingCard = trackingNumber
    ? renderHighlightCard({
        label: "Tracking",
        title: `${carrierLabel} · ${trackingNumber}`,
        subtitle: trackingUrl
          ? "Click below to follow your package."
          : undefined,
        note: "Tracking information may take a few hours to update after pickup by the carrier.",
      })
    : renderHighlightCard({
        label: "On its way",
        title: carrierLabel,
        note: "We'll send a follow-up with your tracking number shortly.",
      })

  const bodyHtml = `
    ${trackingCard}
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#2A2828;">
      Your order has shipped. Below is a quick summary of what's on the way.
    </p>
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin:24px 0 12px 0;">Items shipped</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${renderItemRows(order.items, currency)}</table>`

  const cta =
    trackingUrl ||
    (trackingNumber
      ? `https://www.google.com/search?q=${encodeURIComponent(carrierLabel + " " + trackingNumber)}`
      : orderUrl)

  const { html } = renderEmail({
    preheader: `Your order${display ? " " + display : ""} has shipped${trackingNumber ? " — " + carrierLabel + " " + trackingNumber : ""}.`,
    eyebrow: "On its way",
    heading: display ? `Order ${display} has shipped` : "Your order has shipped",
    intro:
      "Good news — your order is on the move. Track your package below.",
    bodyHtml,
    ctaUrl: cta,
    ctaLabel: trackingUrl ? "Track package" : "View order",
    footerNote: `Need to make a change? Reply to this email right away — once a package is in the carrier's hands we may not be able to intercept it.`,
  })

  const text = renderTextFromLines([
    `Your order${display ? " " + display : ""} has shipped`,
    "",
    `Carrier: ${carrierLabel}`,
    trackingNumber ? `Tracking: ${trackingNumber}` : "",
    trackingUrl ? `Track: ${trackingUrl}` : "",
    "",
    "Items shipped:",
    ...(order.items?.map((i) => `  ${i.quantity} x ${i.title}`) || []),
    "",
    `View order: ${orderUrl}`,
  ])

  return {
    subject: `Shipped${display ? " " + display : ""} — your Griller's Pride order is on the way`,
    html,
    text,
  }
}
