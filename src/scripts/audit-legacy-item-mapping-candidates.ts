import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listLegacyItemMappingCandidates } from "../lib/legacy-item-mapping-review"
import {
  getNumberArg,
  getStringArg,
  parseArgs,
} from "./lib/legacy-import-utils"

export default async function auditLegacyItemMappingCandidates({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const limit = getNumberArg(args, ["limit"], 20)
  const minLines = getNumberArg(args, ["min-lines", "min_lines"], 10)
  const q = getStringArg(args, ["q", "query"])

  const result = await listLegacyItemMappingCandidates(db, {
    q,
    limit,
    minLines,
  })

  logger.info(
    `[legacy-item-mapping-candidates-audit] ${JSON.stringify({
      count: result.count,
      returned: result.candidates.length,
      minLines: result.min_lines,
      candidates: result.candidates.map((candidate) => ({
        key: candidate.key,
        qbdItemListId: candidate.qbd_item_list_id,
        sku: candidate.sku,
        title: candidate.title,
        sampleDescription: candidate.sample_description,
        lineCount: candidate.line_count,
        orderCount: candidate.order_count,
        customerCount: candidate.customer_count,
        descriptionCount: candidate.description_count,
        requiresDescriptionMatcher: candidate.requires_description_matcher,
        lastOrderedAt: candidate.last_ordered_at,
      })),
    })}`
  )
}
