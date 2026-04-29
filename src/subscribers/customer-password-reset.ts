import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

console.log("[CPR-LOAD] customer-password-reset subscriber module loaded at boot");

type PasswordResetEvent = {
  entity_id: string;
  actor_type: string;
  token: string;
};

export default async function customerPasswordResetHandler({
  event,
  container,
}: SubscriberArgs<PasswordResetEvent>) {
  const logger = container.resolve("logger");

  logger.info(
    `[customer-password-reset] HANDLER ENTRY full event=${JSON.stringify(event)}`
  );

  const { data } = event;
  const { entity_id, actor_type, token } = data || ({} as PasswordResetEvent);

  logger.info(
    `[customer-password-reset] subscriber fired entity_id=${entity_id} actor_type=${actor_type} token_len=${token?.length || 0}`
  );

  if (actor_type !== "customer") {
    logger.info(
      `[customer-password-reset] skipping non-customer actor_type=${actor_type}`
    );
    return;
  }

  const notificationModule = container.resolve(Modules.NOTIFICATION);

  const storefrontUrl =
    process.env.STOREFRONT_URL || "https://grillerspride.com";

  const resetUrl =
    `${storefrontUrl}/us/reset-password` +
    `?token=${encodeURIComponent(token)}` +
    `&email=${encodeURIComponent(entity_id)}`;

  logger.info(
    `[customer-password-reset] calling notificationModule.createNotifications to=${entity_id} resetUrl=${resetUrl}`
  );

  try {
    const result = await notificationModule.createNotifications({
      to: entity_id,
      channel: "email",
      template: "customer-password-reset",
      content: {
        subject: "Reset your Griller's Pride password",
        html: `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5;color:#222;">
          <h2>Reset your password</h2>
          <p>Click the link below to set a new password. This link expires in 15 minutes.</p>
          <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#0a3161;color:#fff;text-decoration:none;border-radius:4px;">Reset password</a></p>
          <p>If the button doesn't work, paste this URL into your browser:<br/>${resetUrl}</p>
          <p>If you didn't request this, you can safely ignore this email.</p>
        </body></html>`,
        text: `Reset your Griller's Pride password (link expires in 15 minutes): ${resetUrl}`,
      },
      data: { resetUrl, email: entity_id },
    });
    logger.info(
      `[customer-password-reset] createNotifications returned: ${JSON.stringify(result)}`
    );
  } catch (err) {
    logger.error(
      `[customer-password-reset] failed to send email to ${entity_id}: ${err instanceof Error ? err.message : String(err)}`
    );
    if (err instanceof Error && err.stack) {
      logger.error(`[customer-password-reset] stack: ${err.stack}`);
    }
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
};
