import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { buildPasswordResetEmail } from "../lib/emails/templates/password-reset";

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

  const { data } = event;
  const { entity_id, actor_type, token } = data || ({} as PasswordResetEvent);

  if (actor_type !== "customer") {
    return;
  }

  const notificationModule = container.resolve(Modules.NOTIFICATION);

  const { subject, html, text } = buildPasswordResetEmail({
    email: entity_id,
    token,
  });

  try {
    await notificationModule.createNotifications({
      to: entity_id,
      channel: "email",
      template: "customer-password-reset",
      content: { subject, html, text },
      data: { email: entity_id },
    });
    logger.info(
      `[customer-password-reset] sent reset email to=${entity_id}`
    );
  } catch (err) {
    logger.error(
      `[customer-password-reset] failed to send email to ${entity_id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
};
