import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { buildPasswordResetEmail } from "../lib/emails/templates/password-reset";
import { sendTrackedEmail } from "../lib/communications/core";
import { emitTransactionalEmailHandlerFailureAlert } from "../lib/emails/ops-alerts";

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

  try {
    const { subject, html, text } = buildPasswordResetEmail({
      email: entity_id,
      token,
    });

    await sendTrackedEmail(container, {
      to: entity_id,
      stream: "transactional",
      purpose: "transactional",
      template_key: "customer-password-reset",
      subject,
      html,
      text,
      topic: "account",
      idempotency_key: `customer-password-reset:${entity_id}:${token}`,
      metadata: { email: entity_id },
    });
    logger.info(
      `[customer-password-reset] sent reset email to=${entity_id}`
    );
  } catch (err) {
    logger.error(
      `[customer-password-reset] failed to send email to ${entity_id}: ${err instanceof Error ? err.message : String(err)}`
    );
    void emitTransactionalEmailHandlerFailureAlert({
      logger,
      templateKey: "customer-password-reset",
      path: "src/subscribers/customer-password-reset.ts",
      eventName: "auth.password_reset",
      error: err,
    });
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
};
