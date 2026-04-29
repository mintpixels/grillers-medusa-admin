import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

type PasswordResetEvent = {
  entity_id: string;
  actor_type: string;
  token: string;
};

export default async function customerPasswordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<PasswordResetEvent>) {
  const { entity_id, actor_type, token } = data;

  if (actor_type !== "customer") {
    return;
  }

  const logger = container.resolve("logger");
  const notificationModule = container.resolve(Modules.NOTIFICATION);

  const storefrontUrl =
    process.env.STOREFRONT_URL || "https://grillerspride.com";

  const resetUrl =
    `${storefrontUrl}/us/reset-password` +
    `?token=${encodeURIComponent(token)}` +
    `&email=${encodeURIComponent(entity_id)}`;

  try {
    await notificationModule.createNotifications({
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
  } catch (err) {
    logger.error(
      `auth.password_reset → failed to send email to ${entity_id}:`,
      err
    );
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
};
