export const escapeHtml = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export const formatMoney = (
  n: number | string | null | undefined,
  currency = "USD"
): string => {
  const v = typeof n === "string" ? parseFloat(n) : n
  if (v === null || v === undefined || Number.isNaN(v)) return ""
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(v as number)
}

type Address = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  province?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
}

export const formatCityStateZip = (addr: Address): string => {
  const city = addr.city?.trim() || ""
  const state = addr.province?.trim() || ""
  const zip = addr.postal_code?.trim() || ""
  if (city && state && zip) return `${city}, ${state} ${zip}`
  if (city && state) return `${city}, ${state}`
  if (city && zip) return `${city} ${zip}`
  if (state && zip) return `${state} ${zip}`
  return city || state || zip
}

export const renderAddressBlock = (addr: Address | null | undefined): string => {
  if (!addr) return ""
  const lines: string[] = []
  const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim()
  if (name) lines.push(name)
  if (addr.company) lines.push(addr.company)
  if (addr.address_1) lines.push(addr.address_1)
  if (addr.address_2) lines.push(addr.address_2)
  const cs = formatCityStateZip(addr)
  if (cs) lines.push(cs)
  if (addr.country_code) lines.push(String(addr.country_code).toUpperCase())
  if (addr.phone) lines.push(addr.phone)
  return lines.map((l) => escapeHtml(l)).join("<br/>")
}

type LineItem = {
  title?: string | null
  display_title?: string | null
  product_title?: string | null
  variant_title?: string | null
  sku?: string | null
  quantity?: number | null
  unit_price?: number | null
  line_total?: number | null
  thumbnail?: string | null
}

export const formatQuantity = (n: number | null | undefined): string => {
  const value = Number(n ?? 0)
  if (!Number.isFinite(value)) return "0"
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", { maximumFractionDigits: 3 })
}

export const renderItemRows = (
  items: LineItem[] | null | undefined,
  currency = "USD"
): string => {
  if (!items?.length) return ""
  return items
    .map((item) => {
      const qty = item.quantity ?? 0
      const unit = item.unit_price ?? 0
      const lineTotal = formatMoney(
        item.line_total ?? unit * qty,
        currency
      )
      const title =
        item.display_title ||
        item.product_title ||
        item.title ||
        "Griller's Pride item"
      const subtext = item.sku ? `SKU ${item.sku}` : null
      const subtitle = subtext
        ? `<div style="color:#6F665B;font-size:13px;font-weight:600;line-height:1.35;margin-top:2px;">${escapeHtml(subtext)}</div>`
        : ""
      const thumb = item.thumbnail
        ? `<img src="${escapeHtml(item.thumbnail)}" width="58" height="58" alt="" style="display:block;border-radius:6px;object-fit:cover;border:1px solid #E4DED2;background:#F7F3EA;"/>`
        : ""
      return `
        <tr>
          <td valign="top" style="padding:16px 0;border-bottom:1px solid #E8E2D7;width:74px;">${thumb}</td>
          <td valign="top" style="padding:16px 12px;border-bottom:1px solid #E8E2D7;">
            <div style="font-weight:700;color:#17201A;font-size:15px;line-height:1.35;">${escapeHtml(title)}</div>
            ${subtitle}
            <div style="color:#6F665B;font-size:13px;margin-top:5px;">Qty ${formatQuantity(qty)} &times; ${formatMoney(unit, currency)}</div>
          </td>
          <td valign="top" style="padding:16px 0;border-bottom:1px solid #E8E2D7;text-align:right;font-weight:700;color:#17201A;font-size:15px;white-space:nowrap;">${lineTotal}</td>
        </tr>`
    })
    .join("")
}

type TotalsRow = { label: string; value: string; emphasize?: boolean }

export const renderTotalsTable = (rows: TotalsRow[]): string => {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
      ${rows
        .map((r) => {
          if (r.emphasize) {
            return `<tr>
              <td style="padding:12px 0 0 0;border-top:2px solid #17201A;font-weight:700;color:#17201A;font-size:16px;">${escapeHtml(r.label)}</td>
              <td style="padding:12px 0 0 0;border-top:2px solid #17201A;text-align:right;font-weight:700;color:#17201A;font-size:16px;">${r.value}</td>
            </tr>`
          }
          return `<tr>
            <td style="padding:5px 0;color:#6F665B;">${escapeHtml(r.label)}</td>
            <td style="padding:5px 0;text-align:right;color:#2A2828;">${r.value}</td>
          </tr>`
        })
        .join("")}
    </table>`
}

export const renderHighlightCard = ({
  label,
  title,
  subtitle,
  note,
}: {
  label?: string
  title: string
  subtitle?: string
  note?: string
}): string => {
  return `
    <div style="background:#FBFAF6;border:1px solid #E4DED2;padding:18px 20px;border-radius:6px;margin-bottom:28px;">
      ${label ? `<div style="font-size:11px;letter-spacing:0;text-transform:uppercase;color:#8B5E2D;font-weight:700;margin-bottom:7px;">${escapeHtml(label)}</div>` : ""}
      <div style="font-size:18px;font-weight:700;color:#17201A;line-height:1.3;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:14px;color:#2A2828;margin-top:5px;">${escapeHtml(subtitle)}</div>` : ""}
      ${note ? `<div style="font-size:13px;color:#6F665B;margin-top:10px;line-height:1.5;">${escapeHtml(note)}</div>` : ""}
    </div>`
}

export const renderButton = ({
  href,
  label,
}: {
  href: string
  label: string
}): string => {
  return `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:8px auto;">
      <tr>
        <td align="center" style="border-radius:4px;background:#0B5A43;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:4px;letter-spacing:0;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}
