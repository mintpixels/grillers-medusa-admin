import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { generateResetPasswordTokenWorkflow } from "@medusajs/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

console.log("[FP-LOAD] /store/forgot-password route loaded at boot");

type Body = { email?: string };

const BRAND = {
  charcoal: "#2A2828",
  scroll: "#F0F0ED",
  israelBlue: "#2D479D",
  richGold: "#BB925C",
  gold: "#E5B565",
  pewter: "#B1A6A2",
  black: "#001B23",
};

function buildResetEmailHtml(resetUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light only" />
    <meta name="supported-color-schemes" content="light only" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:0;background-color:${BRAND.scroll};font-family:Helvetica,Arial,sans-serif;color:${BRAND.charcoal};-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BRAND.scroll};">
      Reset your Griller's Pride password — link expires in 15 minutes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BRAND.scroll};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr>
              <td style="background-color:${BRAND.israelBlue};padding:28px 32px;text-align:center;">
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;letter-spacing:0.08em;color:#ffffff;font-weight:700;">
                  GRILLER'S PRIDE
                </div>
                <div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.3em;color:${BRAND.gold};margin-top:6px;text-transform:uppercase;">
                  Premium &middot; Kosher &middot; Hand-cut
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:40px 40px 16px 40px;">
                <h1 style="margin:0 0 16px 0;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;color:${BRAND.charcoal};font-weight:700;">
                  Reset your password
                </h1>
                <p style="margin:0 0 24px 0;font-size:16px;line-height:1.6;color:${BRAND.charcoal};">
                  We received a request to reset the password on your Griller's Pride account. Click the button below to choose a new one. This link is valid for <strong>15 minutes</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                  <tr>
                    <td align="center" style="border-radius:4px;background-color:${BRAND.richGold};">
                      <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.12em;color:#ffffff;text-transform:uppercase;text-decoration:none;border-radius:4px;">
                        Reset password
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:${BRAND.pewter};">
                  Button not working? Copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.6;word-break:break-all;">
                  <a href="${resetUrl}" target="_blank" style="color:${BRAND.israelBlue};text-decoration:underline;">${resetUrl}</a>
                </p>
                <hr style="border:none;border-top:1px solid ${BRAND.scroll};margin:24px 0;" />
                <p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.pewter};">
                  Didn't request this? You can safely ignore this email — your password won't change unless you click the link above.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:${BRAND.scroll};padding:24px 40px;text-align:center;border-top:1px solid #e9e7e2;">
                <p style="margin:0 0 6px 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:0.2em;color:${BRAND.charcoal};text-transform:uppercase;font-weight:700;">
                  Griller's Pride
                </p>
                <p style="margin:0;font-size:12px;line-height:1.5;color:${BRAND.pewter};">
                  Questions? Reply to this email or visit our customer service page.
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;line-height:1.5;color:${BRAND.pewter};">
            This is a transactional email sent in response to a password reset request.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildResetEmailText(resetUrl: string): string {
  return [
    "Griller's Pride — Reset your password",
    "",
    "We received a request to reset the password on your Griller's Pride account.",
    "Click the link below to choose a new password. This link is valid for 15 minutes.",
    "",
    resetUrl,
    "",
    "Didn't request this? You can safely ignore this email — your password won't change unless you click the link.",
    "",
    "— Griller's Pride",
  ].join("\n");
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger");
  const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;

  const body = (req.body || {}) as Body;
  const email = body.email?.trim().toLowerCase();

  if (!email) {
    res.status(400).json({ error: "email is required" });
    return;
  }

  logger.info(`[forgot-password] requested for ${email}`);

  // Generate the reset token via Medusa's built-in workflow.
  // If the customer doesn't exist this throws — we swallow and still
  // return 201 so we don't leak whether the email is registered.
  let token: string | null = null;
  try {
    const { result } = await generateResetPasswordTokenWorkflow(req.scope).run({
      input: {
        entityId: email,
        actorType: "customer",
        provider: "emailpass",
        secret: config?.projectConfig?.http?.jwtSecret || process.env.JWT_SECRET || "supersecret",
      },
    });
    token = (result as unknown as string) || null;
    logger.info(`[forgot-password] token generated len=${token?.length || 0}`);
  } catch (err: any) {
    logger.info(
      `[forgot-password] no provider identity for ${email} (returning 201 to avoid leaking existence): ${err?.message || err}`
    );
    res.status(201).json({ ok: true });
    return;
  }

  if (!token) {
    res.status(201).json({ ok: true });
    return;
  }

  const storefrontUrl = process.env.STOREFRONT_URL || "https://grillerspride.com";
  const resetUrl =
    `${storefrontUrl}/us/reset-password` +
    `?token=${encodeURIComponent(token)}` +
    `&email=${encodeURIComponent(email)}`;

  const apiToken = process.env.POSTMARK_API_TOKEN;
  const fromAddress = process.env.POSTMARK_FROM;

  if (!apiToken || !fromAddress) {
    logger.error(
      `[forgot-password] missing Postmark config: hasToken=${!!apiToken} hasFrom=${!!fromAddress}`
    );
    res.status(500).json({ error: "email service misconfigured" });
    return;
  }

  logger.info(
    `[forgot-password] POST api.postmarkapp.com from=${fromAddress} to=${email}`
  );

  const postmarkRes = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": apiToken,
    },
    body: JSON.stringify({
      From: fromAddress,
      To: email,
      Subject: "Reset your Griller's Pride password",
      HtmlBody: buildResetEmailHtml(resetUrl),
      TextBody: buildResetEmailText(resetUrl),
      MessageStream: "outbound",
    }),
  });

  if (!postmarkRes.ok) {
    const errBody = await postmarkRes.text();
    logger.error(
      `[forgot-password] Postmark rejected: status=${postmarkRes.status} body=${errBody}`
    );
    res.status(500).json({ error: "email send failed" });
    return;
  }

  const result = (await postmarkRes.json()) as { MessageID?: string };
  logger.info(`[forgot-password] Postmark accepted MessageID=${result.MessageID}`);

  res.status(201).json({ ok: true });
}
