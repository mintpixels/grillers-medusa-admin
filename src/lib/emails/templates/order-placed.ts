import { renderEmail, renderTextFromLines, STOREFRONT_URL } from "../layout"
import {
  formatMoney,
  renderItemRows,
  renderTotalsTable,
  renderAddressBlock,
  renderHighlightCard,
  formatCityStateZip,
  escapeHtml,
} from "../components"
import {
  getFulfillmentInfo,
  getPaymentLabel,
  type OrderForEmail,
} from "../order-fetch"

export const buildOrderPlacedEmail = (order: OrderForEmail) => {
  const currency = (order.currency_code || "USD").toUpperCase()
  const display = order.display_id ? `#${order.display_id}` : ""
  const orderUrl = `${STOREFRONT_URL}/us/order/${order.id}/confirmed`
  const {
    isPickup,
    scheduledDate,
    shippingMethodName,
  } = getFulfillmentInfo(order)
  const paymentLabel = getPaymentLabel(order)

  const fulfillmentCard = isPickup
    ? renderHighlightCard({
        label: "Pickup details",
        title: shippingMethodName,
        subtitle: scheduledDate
          ? `Scheduled for ${scheduledDate}`
          : "We'll email you when your order is ready.",
        note: "Please bring a photo ID and your order number when you arrive.",
      })
    : renderHighlightCard({
        label: "Delivery details",
        title: shippingMethodName,
        subtitle: scheduledDate
          ? `Expected delivery ${scheduledDate}`
          : undefined,
        note: "You'll receive a tracking number by email once your order ships.",
      })

  const totalsRows: Array<{ label: string; value: string; emphasize?: boolean }> = [
    { label: "Subtotal", value: formatMoney(order.subtotal, currency) },
    { label: "Shipping", value: formatMoney(order.shipping_total, currency) },
  ]
  if (Number(order.discount_total) > 0) {
    totalsRows.push({
      label: "Discount",
      value: `-${formatMoney(order.discount_total, currency)}`,
    })
  }
  totalsRows.push({
    label: "Taxes (estimated)",
    value: formatMoney(order.tax_total, currency),
  })
  totalsRows.push({
    label: "Total (authorized)",
    value: formatMoney(order.total, currency),
    emphasize: true,
  })

  const addressBlock = renderAddressBlock(order.shipping_address || undefined)

  const bodyHtml = `
    ${fulfillmentCard}
    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:12px;">Items ordered</div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">${renderItemRows(order.items, currency)}</table>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
      <tr>
        <td valign="top" class="stack-col stack-col-first" style="width:50%;padding-right:24px;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:10px;">${isPickup ? "Pickup contact" : "Shipping address"}</div>
          <div style="font-size:14px;line-height:1.6;color:#001B23;">${addressBlock || '<span style="color:#686674;">—</span>'}</div>
        </td>
        <td valign="top" class="stack-col" style="width:50%;padding-left:24px;border-left:1px solid #F0F0ED;">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:10px;">Payment</div>
          <div style="font-size:14px;color:#001B23;margin-bottom:18px;">${escapeHtml(paymentLabel)}</div>
          ${renderTotalsTable(totalsRows)}
        </td>
      </tr>
    </table>`

  const footerNote = `
    <strong style="color:#001B23;">A note on catch-weight pricing.</strong> Most cuts are sold by the pound. Your card has been <em>authorized</em> for the estimate above — not yet charged. We'll weigh your order before it ships and adjust the final charge (within &plusmn;15%). <a href="${STOREFRONT_URL}/us/page/catch-weight-pricing">Learn more</a>.`

  const { html } = renderEmail({
    preheader: `Order confirmed${display ? " " + display : ""} — total ${formatMoney(order.total, currency)}.`,
    eyebrow: "Order confirmed",
    heading: display ? `Order ${display}` : "Order confirmed",
    intro:
      "Thanks for your order. We've received it and our butchers are on it.",
    bodyHtml,
    ctaUrl: orderUrl,
    ctaLabel: "View order",
    footerNote,
  })

  const cityStateZip = formatCityStateZip(order.shipping_address || ({} as any))
  const text = renderTextFromLines([
    `Order confirmed${display ? " " + display : ""}`,
    "",
    "Thanks for your order. We've received it and our butchers are on it.",
    "",
    `${shippingMethodName}${scheduledDate ? " — " + scheduledDate : ""}`,
    "",
    "Items:",
    ...(order.items?.map(
      (i) =>
        `  ${i.quantity} x ${i.title} — ${formatMoney(
          (i.unit_price || 0) * (i.quantity || 0),
          currency
        )}`
    ) || []),
    "",
    isPickup ? "Pickup contact:" : "Shipping to:",
    `${order.shipping_address?.first_name || ""} ${order.shipping_address?.last_name || ""}`.trim(),
    order.shipping_address?.address_1 || "",
    order.shipping_address?.address_2 || "",
    cityStateZip,
    order.shipping_address?.phone || "",
    "",
    `Subtotal: ${formatMoney(order.subtotal, currency)}`,
    `Shipping: ${formatMoney(order.shipping_total, currency)}`,
    Number(order.discount_total) > 0
      ? `Discount: -${formatMoney(order.discount_total, currency)}`
      : "",
    `Taxes (estimated): ${formatMoney(order.tax_total, currency)}`,
    `Total (authorized): ${formatMoney(order.total, currency)}`,
    "",
    `View order: ${orderUrl}`,
  ])

  return {
    subject: `Order confirmed${display ? " " + display : ""} — Griller's Pride`,
    html,
    text,
  }
}
