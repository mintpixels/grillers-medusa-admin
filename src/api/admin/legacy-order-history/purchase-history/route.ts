import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listLegacyPurchaseHistoryForCustomer } from "../../../../lib/legacy-order-history"

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value[0] === undefined ? undefined : String(value[0])
  }

  return value === undefined ? undefined : String(value)
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const customerId = firstQueryValue(req.query.customer_id)?.trim()
  if (!customerId) {
    res.status(400).json({ message: "Missing customer_id" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const purchaseHistory = await listLegacyPurchaseHistoryForCustomer(
    db,
    customerId
  )

  res.json({ purchase_history: purchaseHistory })
}
