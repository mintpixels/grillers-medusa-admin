import type { MedusaContainer } from "@medusajs/framework/types"
import { runDueFlowEnrollments } from "../lib/communications/flows"
import {
  emitCommunicationsFlowStepErrorsAlert,
  emitCommunicationsScheduledJobFailureAlert,
} from "./communications-job-alerts"

export default async function gpCommunicationsFlowRunner(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  try {
    const summary = await runDueFlowEnrollments(container, 100)
    if (summary.processed || summary.errors) {
      logger.info(`[communications-flow-runner] ${JSON.stringify(summary)}`)
    }
    if (summary.errors) {
      await emitCommunicationsFlowStepErrorsAlert({
        jobName: config.name,
        summary,
        logger,
      })
    }
  } catch (error) {
    logger.error(
      `[communications-flow-runner] failed: ${
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
  name: "gp-communications-flow-runner",
  schedule: "* * * * *",
}
