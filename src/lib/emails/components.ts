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
  variant_title?: string | null
  quantity?: number | null
  unit_price?: number | null
  thumbnail?: string | null
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
      const lineTotal = formatMoney(unit * qty, currency)
      const variant = item.variant_title
        ? ` <span style="color:#686674;">&middot; ${escapeHtml(item.variant_title)}</span>`
        : ""
      const thumb = item.thumbnail
        ? `<img src="${escapeHtml(item.thumbnail)}" width="56" height="56" alt="" style="display:block;border-radius:4px;object-fit:cover;border:1px solid #e5e7eb;"/>`
        : ""
      return `
        <tr>
          <td valign="top" style="padding:14px 0;border-bottom:1px solid #F0F0ED;width:72px;">${thumb}</td>
          <td valign="top" style="padding:14px 12px;border-bottom:1px solid #F0F0ED;">
            <div style="font-weight:600;color:#001B23;font-size:15px;line-height:1.4;">${escapeHtml(item.title)}${variant}</div>
            <div style="color:#686674;font-size:13px;margin-top:4px;">Qty ${qty} &times; ${formatMoney(unit, currency)}</div>
          </td>
          <td valign="top" style="padding:14px 0;border-bottom:1px solid #F0F0ED;text-align:right;font-weight:600;color:#001B23;font-size:15px;white-space:nowrap;">${lineTotal}</td>
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
              <td style="padding:12px 0 0 0;border-top:2px solid #001B23;font-weight:700;color:#001B23;font-size:16px;">${escapeHtml(r.label)}</td>
              <td style="padding:12px 0 0 0;border-top:2px solid #001B23;text-align:right;font-weight:700;color:#001B23;font-size:16px;">${r.value}</td>
            </tr>`
          }
          return `<tr>
            <td style="padding:5px 0;color:#686674;">${escapeHtml(r.label)}</td>
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
    <div style="background:#F0F0ED;border-left:4px solid #BB925C;padding:18px 20px;border-radius:4px;margin-bottom:28px;">
      ${label ? `<div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#735048;font-weight:600;margin-bottom:6px;">${escapeHtml(label)}</div>` : ""}
      <div style="font-size:18px;font-weight:600;color:#001B23;line-height:1.3;">${escapeHtml(title)}</div>
      ${subtitle ? `<div style="font-size:14px;color:#2A2828;margin-top:4px;">${escapeHtml(subtitle)}</div>` : ""}
      ${note ? `<div style="font-size:13px;color:#686674;margin-top:10px;line-height:1.5;">${escapeHtml(note)}</div>` : ""}
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
        <td align="center" style="border-radius:4px;background:#2D479D;">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:4px;letter-spacing:0.3px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}
