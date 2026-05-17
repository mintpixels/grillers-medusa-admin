import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listLegacyItemMappingCandidates } from "../../../lib/legacy-item-mapping-review"

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] === undefined ? undefined : String(value[0])
  }

  return value === undefined ? undefined : String(value)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const result = await listLegacyItemMappingCandidates(db, {
    q: firstQueryValue(req.query.q),
    limit: Number(firstQueryValue(req.query.limit)) || 50,
    offset: Number(firstQueryValue(req.query.offset)) || 0,
    minLines: Number(firstQueryValue(req.query.min_lines)) || 2,
  })

  res.json(result)
}
