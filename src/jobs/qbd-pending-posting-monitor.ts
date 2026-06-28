import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { emitOpsAlert } from "../lib/ops-alert"
import { emitStaleQbdPostingAlertFromDb } from "../lib/qbd-pending-posting-alerts"

function errorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error || "Unknown error")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500)
}

export default async function qbdPendingPostingMonitor(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const result = await emitStaleQbdPostingAlertFromDb({
      db,
      logger,
      path: "src/jobs/qbd-pending-posting-monitor.ts",
    })

    if (result.candidateCount || result.emitted) {
      logger.info(
        `[qbd-pending-posting-monitor] ${JSON.stringify(result)}`
      )
    }
  } catch (error) {
    logger.error(
      `[qbd-pending-posting-monitor] failed: ${errorMessage(error)}`
    )
    await emitOpsAlert({
      alertKind: "qbd_pending_posting_monitor_failed",
      title: "QBD pending posting monitor failed",
      path: "src/jobs/qbd-pending-posting-monitor.ts",
      source: "medusa-server",
      severity: "warn",
      logger,
      meta: {
        job_name: config.name,
        error_message: errorMessage(error),
      },
    })
    throw error
  }
}

export const config = {
  name: "qbd-pending-posting-monitor",
  schedule: "*/30 * * * *",
}
