import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";

console.log("[MIRROR-LOAD] _zz_debug_mirror subscriber module loaded at boot");

export default async function mirrorAuthPasswordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<Record<string, unknown>>) {
  const logger = container.resolve("logger");
  logger.info(
    `[MIRROR] auth.password_reset received data=${JSON.stringify(data)}`
  );
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
};
