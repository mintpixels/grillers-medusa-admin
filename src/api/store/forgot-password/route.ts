import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { generateResetPasswordTokenWorkflow } from "@medusajs/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

console.log("[FP-LOAD] /store/forgot-password route loaded at boot");

type Body = { email?: string };

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
      HtmlBody: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#222;">
        <h2>Reset your password</h2>
        <p>Click the link below to set a new password. This link expires in 15 minutes.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#0a3161;color:#fff;text-decoration:none;border-radius:4px;">Reset password</a></p>
        <p>If the button doesn't work, paste this URL into your browser:<br/>${resetUrl}</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      </body></html>`,
      TextBody: `Reset your Griller's Pride password (link expires in 15 minutes): ${resetUrl}`,
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
