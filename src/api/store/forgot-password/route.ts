import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { generateResetPasswordTokenWorkflow } from "@medusajs/core-flows";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { buildPasswordResetEmail } from "../../../lib/emails/templates/password-reset";
import { emitOpsAlert } from "../../../lib/ops-alert";

console.log("[FP-LOAD] /store/forgot-password route loaded at boot");

type Body = { email?: string };

function redactedProviderError(error: string): string {
  return String(error || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500);
}

async function emitForgotPasswordEmailFailureAlert(input: {
  logger: any;
  failureStage: "missing_config" | "postmark_rejected" | "request_failed";
  responseStatus?: number | null;
  providerError?: string;
}) {
  await emitOpsAlert({
    alertKind: "forgot_password_email_failed",
    severity: "warn",
    title: "Forgot-password email failed",
    path: "src/api/store/forgot-password/route.ts",
    source: "medusa-server",
    logger: input.logger,
    meta: {
      failure_stage: input.failureStage,
      response_status: input.responseStatus ?? null,
      provider_error: input.providerError
        ? redactedProviderError(input.providerError)
        : null,
    },
  });
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
  // If the customer doesn't exist this throws; we swallow and still
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

  const apiToken = process.env.POSTMARK_API_TOKEN;
  const fromAddress = process.env.POSTMARK_FROM;
  const emailContent = buildPasswordResetEmail({ email, token });

  if (!apiToken || !fromAddress) {
    logger.error(
      `[forgot-password] missing Postmark config: hasToken=${!!apiToken} hasFrom=${!!fromAddress}`
    );
    await emitForgotPasswordEmailFailureAlert({
      logger,
      failureStage: "missing_config",
    });
    res.status(500).json({ error: "email service misconfigured" });
    return;
  }

  logger.info(
    `[forgot-password] POST api.postmarkapp.com from=${fromAddress} to=${email}`
  );

  let postmarkRes: Response;
  try {
    postmarkRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": apiToken,
      },
      body: JSON.stringify({
        From: fromAddress,
        To: email,
        Subject: emailContent.subject,
        HtmlBody: emailContent.html,
        TextBody: emailContent.text,
        MessageStream: "outbound",
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[forgot-password] Postmark request failed: ${message}`);
    await emitForgotPasswordEmailFailureAlert({
      logger,
      failureStage: "request_failed",
      providerError: message,
    });
    res.status(500).json({ error: "email send failed" });
    return;
  }

  if (!postmarkRes.ok) {
    const errBody = await postmarkRes.text();
    logger.error(
      `[forgot-password] Postmark rejected: status=${postmarkRes.status} body=${errBody}`
    );
    await emitForgotPasswordEmailFailureAlert({
      logger,
      failureStage: "postmark_rejected",
      responseStatus: postmarkRes.status,
      providerError: errBody,
    });
    res.status(500).json({ error: "email send failed" });
    return;
  }

  const result = (await postmarkRes.json()) as { MessageID?: string };
  logger.info(`[forgot-password] Postmark accepted MessageID=${result.MessageID}`);

  res.status(201).json({ ok: true });
}
