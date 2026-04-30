import { escapeHtml } from "./components"

export const STOREFRONT_URL =
  process.env.STOREFRONT_URL || "https://grillerspride.com"

export const SUPPORT_EMAIL =
  process.env.SUPPORT_EMAIL || "peter@grillerspride.com"

export const SUPPORT_PHONE = process.env.SUPPORT_PHONE || "(770) 454-8108"

type LayoutInput = {
  preheader?: string
  eyebrow?: string
  heading: string
  intro?: string
  bodyHtml: string
  ctaUrl?: string
  ctaLabel?: string
  footerNote?: string
}

const BRAND = {
  blue: "#2D479D",
  gold: "#BB925C",
  charcoal: "#2A2828",
  black: "#001B23",
  scroll: "#F0F0ED",
  smoke: "#686674",
  white: "#ffffff",
}

export const renderEmail = ({
  preheader,
  eyebrow,
  heading,
  intro,
  bodyHtml,
  ctaUrl,
  ctaLabel,
  footerNote,
}: LayoutInput): { html: string; subject?: string } => {
  const safePreheader = preheader ? escapeHtml(preheader) : ""

  const cta =
    ctaUrl && ctaLabel
      ? `
    <table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0 0;">
      <tr>
        <td align="center" style="border-radius:4px;background:${BRAND.blue};">
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;font-weight:600;color:${BRAND.white};text-decoration:none;border-radius:4px;letter-spacing:0.3px;">${escapeHtml(ctaLabel)}</a>
        </td>
      </tr>
    </table>`
      : ""

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width,initial-scale=1"/>
    <meta name="x-apple-disable-message-reformatting"/>
    <title>${escapeHtml(heading)}</title>
    <style>
      @media only screen and (max-width:620px){
        .email-container{width:100% !important;}
        .email-padding{padding:24px 20px !important;}
        .email-hero{padding:32px 20px !important;}
        .email-hero h1{font-size:24px !important;}
        .stack-col{display:block !important;width:100% !important;padding:0 0 20px 0 !important;border-left:none !important;border-top:1px solid ${BRAND.scroll} !important;padding-top:20px !important;}
        .stack-col-first{padding-bottom:20px !important;border-top:none !important;}
      }
      a { color: ${BRAND.blue}; }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.scroll};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.charcoal};-webkit-font-smoothing:antialiased;">
    <div style="display:none;font-size:1px;color:${BRAND.scroll};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${safePreheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.scroll};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.white};border-radius:8px;overflow:hidden;max-width:600px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td class="email-hero" style="background:${BRAND.black};padding:36px 40px;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:3px;color:${BRAND.gold};text-transform:uppercase;">Griller's Pride</div>
                <div style="font-size:11px;letter-spacing:2px;color:${BRAND.smoke};text-transform:uppercase;margin-top:4px;">Premium Kosher Meats</div>
              </td>
            </tr>
            ${
              eyebrow || heading
                ? `<tr>
                <td class="email-padding" style="padding:36px 40px 8px 40px;">
                  ${eyebrow ? `<div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gold};font-weight:600;margin-bottom:12px;">${escapeHtml(eyebrow)}</div>` : ""}
                  <h1 style="margin:0;font-size:28px;line-height:1.25;color:${BRAND.black};font-weight:700;letter-spacing:-0.3px;">${escapeHtml(heading)}</h1>
                </td>
              </tr>`
                : ""
            }
            ${
              intro
                ? `<tr>
                <td class="email-padding" style="padding:16px 40px 0 40px;">
                  <p style="margin:0;font-size:16px;line-height:1.6;color:${BRAND.charcoal};">${escapeHtml(intro)}</p>
                </td>
              </tr>`
                : ""
            }
            <tr>
              <td class="email-padding" style="padding:24px 40px 32px 40px;">
                ${bodyHtml}
                ${cta ? `<div style="margin-top:24px;">${cta}</div>` : ""}
              </td>
            </tr>
            ${
              footerNote
                ? `<tr>
                <td class="email-padding" style="padding:0 40px 32px 40px;">
                  <div style="background:${BRAND.scroll};border-radius:4px;padding:18px 20px;font-size:13px;line-height:1.6;color:${BRAND.charcoal};">${footerNote}</div>
                </td>
              </tr>`
                : ""
            }
            <tr>
              <td style="background:${BRAND.scroll};padding:28px 40px;text-align:center;">
                <div style="font-size:13px;color:${BRAND.smoke};line-height:1.6;">
                  Questions? <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">${escapeHtml(SUPPORT_EMAIL)}</a> &nbsp;|&nbsp; <a href="tel:${escapeHtml(SUPPORT_PHONE.replace(/\D/g, ""))}" style="color:${BRAND.blue};text-decoration:none;font-weight:600;">${escapeHtml(SUPPORT_PHONE)}</a>
                </div>
                <div style="font-size:11px;color:${BRAND.smoke};margin-top:14px;letter-spacing:0.5px;">
                  &copy; Griller's Pride &middot; <a href="${escapeHtml(STOREFRONT_URL)}" style="color:${BRAND.smoke};text-decoration:none;">grillerspride.com</a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { html }
}

export const renderTextFromLines = (lines: string[]): string =>
  lines.filter((l) => l !== null && l !== undefined).join("\n")
