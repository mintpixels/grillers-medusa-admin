import { renderEmail, renderTextFromLines, SUPPORT_PHONE } from "../layout"
import { escapeHtml, formatMoney } from "../components"

type LegacyReorderRequestEmailInput = {
  requestId: string
  customerId: string
  customerName?: string | null
  customerEmail?: string | null
  item: {
    key: string
    title: string
    productTitle?: string | null
    legacyItemId?: string | null
    sku?: string | null
    lastOrderedAt?: string | null
    lastOrderRef?: string | null
    timesOrdered?: number | null
    orderCount?: number | null
    totalQuantity?: number | null
    unitPrice?: number | null
    currencyCode?: string | null
    mappingStatus?: string | null
    variantId?: string | null
    productId?: string | null
  }
}

const ADMIN_BASE_URL = (
  process.env.MEDUSA_ADMIN_URL ||
  process.env.MEDUSA_BACKEND_URL ||
  "https://grillers-medusa-admin-production.up.railway.app"
).replace(/\/+$/, "")

const formatDate = (value?: string | null) => {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

const renderField = (label: string, value?: string | number | null) => {
  if (value === null || value === undefined || value === "") {
    return ""
  }

  return `
    <tr>
      <td style="padding:8px 12px 8px 0;color:#686674;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:8px 0;color:#001B23;font-size:13px;vertical-align:top;">${escapeHtml(String(value))}</td>
    </tr>`
}

export const buildLegacyReorderRequestEmail = ({
  requestId,
  customerId,
  customerName,
  customerEmail,
  item,
}: LegacyReorderRequestEmailInput) => {
  const title = item.productTitle || item.title || "Past purchase"
  const currency = (item.currencyCode || "USD").toUpperCase()
  const adminQuery =
    item.lastOrderRef || item.sku || item.legacyItemId || item.title || item.key
  const legacyOrdersUrl = `${ADMIN_BASE_URL}/app/legacy-orders?q=${encodeURIComponent(
    adminQuery
  )}`
  const lastOrdered = formatDate(item.lastOrderedAt)
  const price =
    typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice)
      ? formatMoney(item.unitPrice, currency)
      : ""

  const bodyHtml = `
    <div style="background:#F0F0ED;border-left:4px solid #BB925C;padding:18px 20px;border-radius:4px;margin-bottom:24px;">
      <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:6px;">Customer asked staff to reorder</div>
      <div style="font-size:18px;font-weight:600;color:#001B23;line-height:1.3;">${escapeHtml(title)}</div>
      ${
        item.sku
          ? `<div style="font-size:13px;color:#686674;margin-top:6px;">SKU ${escapeHtml(item.sku)}</div>`
          : ""
      }
    </div>

    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:10px;">Customer</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${renderField("Name", customerName)}
      ${renderField("Email", customerEmail)}
      ${renderField("Customer ID", customerId)}
    </table>

    <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:10px;">Historical item</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      ${renderField("Request ID", requestId)}
      ${renderField("History key", item.key)}
      ${renderField("Legacy item ID", item.legacyItemId)}
      ${renderField("Last order", item.lastOrderRef)}
      ${renderField("Last ordered", lastOrdered)}
      ${renderField("Orders", item.orderCount || item.timesOrdered || null)}
      ${renderField("Total quantity", item.totalQuantity)}
      ${renderField("Last price", price)}
      ${renderField("Mapping status", item.mappingStatus)}
      ${renderField("Medusa product", item.productId)}
      ${renderField("Medusa variant", item.variantId)}
    </table>

    <p style="margin:0;color:#2A2828;font-size:14px;line-height:1.6;">
      Confirm the historical item in the legacy order screen, then call or email the customer to complete the reorder.
      Store phone: ${escapeHtml(SUPPORT_PHONE)}.
    </p>`

  const { html } = renderEmail({
    preheader: `${customerName || customerEmail || "A customer"} requested help reordering ${title}.`,
    eyebrow: "Reorder request",
    heading: "Staff-assisted reorder requested",
    intro: "A signed-in customer clicked Ask staff to reorder for a historical item that is not available as a normal product card.",
    bodyHtml,
    ctaUrl: legacyOrdersUrl,
    ctaLabel: "Open legacy orders",
  })

  const text = renderTextFromLines([
    "Staff-assisted reorder requested",
    "",
    `Customer: ${customerName || ""}`.trim(),
    `Email: ${customerEmail || ""}`.trim(),
    `Customer ID: ${customerId}`,
    "",
    `Item: ${title}`,
    item.sku ? `SKU: ${item.sku}` : "",
    item.legacyItemId ? `Legacy item ID: ${item.legacyItemId}` : "",
    item.lastOrderRef ? `Last order: ${item.lastOrderRef}` : "",
    lastOrdered ? `Last ordered: ${lastOrdered}` : "",
    `Orders: ${item.orderCount || item.timesOrdered || 0}`,
    `Total quantity: ${item.totalQuantity || 0}`,
    price ? `Last price: ${price}` : "",
    item.mappingStatus ? `Mapping status: ${item.mappingStatus}` : "",
    item.productId ? `Medusa product: ${item.productId}` : "",
    item.variantId ? `Medusa variant: ${item.variantId}` : "",
    "",
    `Request ID: ${requestId}`,
    `History key: ${item.key}`,
    `Legacy orders: ${legacyOrdersUrl}`,
  ])

  return {
    subject: `Legacy reorder request: ${title}`,
    html,
    text,
  }
}
