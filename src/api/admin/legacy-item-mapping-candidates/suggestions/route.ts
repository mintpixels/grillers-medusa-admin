import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { suggestLegacyItemMappings } from "../../../../lib/legacy-item-candidate-suggestions"
import { getLegacyItemMappingCandidate } from "../../../../lib/legacy-item-mapping-review"
import { retrieveQbdItemFact } from "../../../../lib/legacy-qbd-item-facts"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as {
    qbd_item_list_id?: string | null
    sku?: string | null
    title?: string | null
    description_group?: string | null
    limit?: number | string
    min_score?: number | string
  }

  const candidate = await getLegacyItemMappingCandidate(db, {
    qbdItemListId: body.qbd_item_list_id,
    sku: body.sku,
    title: body.title,
    descriptionGroup: body.description_group,
  })

  if (!candidate) {
    res.status(404).json({ message: "Legacy mapping candidate not found" })
    return
  }

  const suggestions = await suggestLegacyItemMappings(db, candidate, {
    limit: Number(body.limit) || 8,
    minScore: Number(body.min_score) || 0.45,
  })
  const qbdItemLookup = await retrieveQbdItemFact(candidate.qbd_item_list_id, {
    logger,
  })

  res.json({
    candidate,
    qbd_item: qbdItemLookup.item,
    qbd_item_lookup: {
      available: qbdItemLookup.available,
      reason: qbdItemLookup.reason,
    },
    suggestions,
  })
}
