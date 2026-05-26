import type { MedusaContainer } from "@medusajs/framework/types"
import { runDueFlowEnrollments } from "../lib/communications/flows"

export default async function gpCommunicationsFlowRunner(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const summary = await runDueFlowEnrollments(container, 100)
  if (summary.processed || summary.errors) {
    logger.info(`[communications-flow-runner] ${JSON.stringify(summary)}`)
  }
}

export const config = {
  name: "gp-communications-flow-runner",
  schedule: "* * * * *",
}
