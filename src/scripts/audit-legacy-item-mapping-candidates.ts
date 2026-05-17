import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { suggestLegacyItemMappings } from "../lib/legacy-item-candidate-suggestions"
import { listLegacyItemMappingCandidates } from "../lib/legacy-item-mapping-review"
import {
  getBooleanArg,
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
  const suggestionLimit = getNumberArg(args, ["suggestion-limit"], 3)
  const minScore = getNumberArg(args, ["min-score", "min_score"], 0.45)
  const includeSuggestions = getBooleanArg(args, ["include-suggestions"], false)
  const q = getStringArg(args, ["q", "query"])

  const result = await listLegacyItemMappingCandidates(db, {
    q,
    limit,
    minLines,
  })

  const candidates: any[] = []
  for (const candidate of result.candidates) {
    const suggestions = includeSuggestions
      ? await suggestLegacyItemMappings(db, candidate, {
          limit: suggestionLimit,
          minScore,
        })
      : []

    candidates.push({
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
      suggestions: suggestions.map((suggestion) => ({
        score: suggestion.score,
        reviewStatus: suggestion.review_status,
        reasons: suggestion.reasons,
        identityWarnings: suggestion.identity_warnings,
        medusaSku: suggestion.sku,
        productTitle: suggestion.product_title,
        variantTitle: suggestion.variant_title,
      })),
    })
  }

  logger.info(
    `[legacy-item-mapping-candidates-audit] ${JSON.stringify({
      count: result.count,
      returned: result.candidates.length,
      minLines: result.min_lines,
      includeSuggestions,
      candidates,
    })}`
  )
}
