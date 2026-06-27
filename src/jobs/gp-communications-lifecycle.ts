import type { MedusaContainer } from "@medusajs/framework/types"
import {
  refreshProfileLifecycle,
  runCommunicationMaintenance,
} from "../lib/communications/admin"
import {
  emitCommunicationsFlowStepErrorsAlert,
  emitCommunicationsScheduledJobFailureAlert,
} from "./communications-job-alerts"

export default async function gpCommunicationsLifecycle(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  try {
    const lifecycle = await refreshProfileLifecycle(container)
    const flows = await runCommunicationMaintenance(container)
    logger.info(
      `[communications-lifecycle] ${JSON.stringify({ lifecycle, flows })}`
    )
    if (flows.errors) {
      await emitCommunicationsFlowStepErrorsAlert({
        jobName: config.name,
        summary: flows,
        logger,
      })
    }
  } catch (error) {
    logger.error(
      `[communications-lifecycle] failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    await emitCommunicationsScheduledJobFailureAlert({
      jobName: config.name,
      error,
      logger,
    })
    throw error
  }
}

export const config = {
  name: "gp-communications-lifecycle",
  schedule: "0 3 * * *",
}
