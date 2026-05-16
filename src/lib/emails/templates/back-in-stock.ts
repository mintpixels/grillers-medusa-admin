type BackInStockEmailInput = {
  productTitle: string
  productUrl: string
  unsubscribeUrl: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function buildBackInStockEmail(input: BackInStockEmailInput) {
  const productTitle = escapeHtml(input.productTitle || "the product")
  const subject = `${input.productTitle || "A product you wanted"} is back in stock at Griller's Pride`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f3ea;color:#242321;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3ea;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5dccb;">
            <tr>
              <td style="padding:28px 28px 12px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b7832f;">
                Griller's Pride
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 8px;font-size:28px;line-height:1.15;font-weight:700;color:#242321;">
                ${productTitle} is back.
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 22px;font-size:16px;line-height:1.55;color:#3f3d39;">
                You asked us to send one note when this came back in stock. It is available now, first come first served at checkout.
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 30px;">
                <a href="${input.productUrl}" style="display:inline-block;background:#2b2927;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:4px;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">
                  Order now
                </a>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e5dccb;padding:18px 28px 28px;font-size:12px;line-height:1.5;color:#6b675f;">
                You are receiving this because you specifically asked to be notified about ${productTitle}. This is not a marketing-list signup.
                <br />
                <a href="${input.unsubscribeUrl}" style="color:#8a6426;">Cancel this notification</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `${input.productTitle || "The product you wanted"} is back in stock at Griller's Pride.`,
    "",
    "You asked us to send one note when this came back. It is available now, first come first served at checkout.",
    "",
    `Order now: ${input.productUrl}`,
    "",
    `Cancel this notification: ${input.unsubscribeUrl}`,
  ].join("\n")

  return { subject, html, text }
}
