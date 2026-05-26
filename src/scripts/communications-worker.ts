import type { MedusaContainer } from "@medusajs/framework/types"
import { startCommunicationWorkers } from "../lib/communications/queue"

export default async function communicationsWorker(container: MedusaContainer) {
  const logger = container.resolve("logger")
  const workers = startCommunicationWorkers(container)
  if (!workers.length) {
    logger.warn("[communications-worker] REDIS_URL is not configured; no BullMQ workers started.")
    return
  }

  logger.info(`[communications-worker] started ${workers.length} workers.`)
  await new Promise(() => undefined)
}
