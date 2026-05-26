import type { MedusaContainer } from "@medusajs/framework/types"
import {
  refreshProfileLifecycle,
  runCommunicationMaintenance,
} from "../lib/communications/admin"

export default async function gpCommunicationsLifecycle(
  container: MedusaContainer
) {
  const logger = container.resolve("logger")
  const lifecycle = await refreshProfileLifecycle(container)
  const flows = await runCommunicationMaintenance(container)
  logger.info(
    `[communications-lifecycle] ${JSON.stringify({ lifecycle, flows })}`
  )
}

export const config = {
  name: "gp-communications-lifecycle",
  schedule: "0 3 * * *",
}
