import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listLegacyOrdersForCustomer } from "../../../../lib/legacy-order-history"

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] === undefined ? undefined : String(value[0])
  }

  return value === undefined ? undefined : String(value)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const result = await listLegacyOrdersForCustomer(db, customerId, {
    limit: Number(firstQueryValue(req.query.limit)),
    offset: Number(firstQueryValue(req.query.offset)),
  })

  res.json(result)
}
