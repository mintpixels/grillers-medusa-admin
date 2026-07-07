import type { MedusaContainer } from "@medusajs/framework/types"
import { ensureCommunicationWorkers } from "../lib/communications/queue"

/**
 * Keeps the BullMQ communication workers alive inside the web process.
 * Idempotent: the first tick after boot starts them, later ticks no-op.
 * Without a consumer the events queue silently backs up and event
 * fan-out (ClickHouse/GA4) plus scheduled campaign sends never run.
 */
export default async function gpCommunicationsWorkerBootstrap(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const result = ensureCommunicationWorkers(container)
  if (result.started) {
    logger.info(
      `[communications-worker-bootstrap] started ${result.count} in-process workers`
    )
  }
}

export const config = {
  name: "gp-communications-worker-bootstrap",
  schedule: "* * * * *",
}
