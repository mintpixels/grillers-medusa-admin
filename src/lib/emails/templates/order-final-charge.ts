import { renderEmail, renderTextFromLines, STOREFRONT_URL } from "../layout"
import {
  formatMoney,
  renderItemRows,
  renderTotalsTable,
  renderHighlightCard,
} from "../components"
import { type OrderForEmail } from "../order-fetch"

export const buildOrderFinalChargeEmail = ({
  order,
  estimatedTotal,
  finalTotal,
}: {
  order: OrderForEmail
  estimatedTotal: number | string
  finalTotal: number | string
}) => {
  const display = order.display_id ? `#${order.display_id}` : ""
  const currency = (order.currency_code || "USD").toUpperCase()
  const orderUrl = `${STOREFRONT_URL}/us/order/${order.id}/confirmed`

  const estNum = Number(estimatedTotal)
  const finNum = Number(finalTotal)
  const delta = finNum - estNum
  const isHigher = delta > 0
  const isLower = delta < 0
  const direction = isHigher
    ? "slightly heavier"
    : isLower
      ? "lighter"
      : "right on the estimate"

  const headlineCard = renderHighlightCard({
    label: "Final charge",
    title: `${formatMoney(finalTotal, currency)}`,
    subtitle:
      delta === 0
        ? `Your cut came in ${direction}.`
        : `Your cut came in ${direction} — ${isHigher ? "+" : "-"}${formatMoney(Math.abs(delta), currency)} vs. the estimate.`,
    note:
      delta === 0
        ? undefined
        : isLower
          ? "You paid less than the estimate. No action needed."
          : "We capped overages at +15% per our catch-weight policy. No action needed.",
  })

  const totalsRows = [
    {
      label: "Original estimate (authorized)",
      value: formatMoney(estimatedTotal, currency),
    },
    {
      label: "Adjustment",
      value: `${delta >= 0 ? "+" : "-"}${formatMoney(Math.abs(delta), currency)}`,
    },
    {
      label: "Final charge",
      value: formatMoney(finalTotal, currency),
      emphasize: true,
    },
  ]

  const bodyHtml = `
    ${headlineCard}
    <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
      Our butchers cut and weighed your order this morning. Below is your final charge — pay only for what you got.
    </p>
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin:24px 0 12px 0;">Charge breakdown</div>
    <div style="margin-bottom:28px;">${renderTotalsTable(totalsRows)}</div>
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin:24px 0 12px 0;">Items</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">${renderItemRows(order.items, currency)}</table>`

  const { html } = renderEmail({
    preheader: `Final charge ${formatMoney(finalTotal, currency)} — ${isHigher ? "+" : isLower ? "-" : "±"}${formatMoney(Math.abs(delta), currency)} from your estimate.`,
    eyebrow: "Catch-weight final charge",
    heading: `Final charge: ${formatMoney(finalTotal, currency)}`,
    intro:
      "Your cut has been weighed and your card has been charged for the actual amount.",
    bodyHtml,
    ctaUrl: orderUrl,
    ctaLabel: "View order",
    footerNote: `Catch-weight pricing means you only pay for what you actually receive — within ±15% of the estimate. <a href="${STOREFRONT_URL}/us/page/catch-weight-pricing">Learn how it works</a>.`,
  })

  const text = renderTextFromLines([
    `Final charge: ${formatMoney(finalTotal, currency)}${display ? " (order " + display + ")" : ""}`,
    "",
    `Original estimate: ${formatMoney(estimatedTotal, currency)}`,
    `Adjustment: ${delta >= 0 ? "+" : "-"}${formatMoney(Math.abs(delta), currency)}`,
    `Final charge: ${formatMoney(finalTotal, currency)}`,
    "",
    `View order: ${orderUrl}`,
  ])

  return {
    subject: `Final charge ${formatMoney(finalTotal, currency)}${display ? " — order " + display : ""}`,
    html,
    text,
  }
}
