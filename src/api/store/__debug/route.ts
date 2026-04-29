import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";

console.log("[DBG-LOAD] /__debug route module loaded at boot");

const SECRET = "GP_DEBUG_2026_04_29";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger = req.scope.resolve("logger");
  logger.info(`[DBG] /__debug GET hit query=${JSON.stringify(req.query)}`);

  if (req.query.secret !== SECRET) {
    logger.info(`[DBG] /__debug rejected: bad secret`);
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const to = (req.query.to as string) || "chris+gp@rndpxl.com";
  const trace: Record<string, unknown> = { to };

  try {
    logger.info(`[DBG] resolving notification module`);
    const notification = req.scope.resolve(Modules.NOTIFICATION) as any;
    trace.resolvedNotification = !!notification;
    trace.notificationKeys = notification ? Object.keys(notification) : [];
    logger.info(
      `[DBG] notification module resolved: keys=${JSON.stringify(trace.notificationKeys)}`
    );

    logger.info(`[DBG] calling createNotifications to=${to}`);
    const result = await notification.createNotifications({
      to,
      channel: "email",
      template: "debug-test",
      content: {
        subject: "Postmark debug test",
        html: "<p>If you got this, the wiring works.</p>",
        text: "If you got this, the wiring works.",
      },
    });
    trace.result = result;
    logger.info(`[DBG] createNotifications returned: ${JSON.stringify(result)}`);
    res.json({ ok: true, trace });
  } catch (err: any) {
    logger.error(
      `[DBG] failed: ${err?.message || String(err)}`
    );
    if (err?.stack) logger.error(`[DBG] stack: ${err.stack}`);
    trace.error = err?.message || String(err);
    trace.stack = err?.stack;
    res.status(500).json({ ok: false, trace });
  }
};
