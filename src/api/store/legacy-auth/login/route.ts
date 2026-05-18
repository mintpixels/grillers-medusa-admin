import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  authenticateLegacyCustomerLogin,
  generateLegacyCustomerAuthToken,
  normalizeLegacyLoginIdentifier,
} from "../../../../lib/legacy-customer-auth"

type Body = {
  email?: string
  identifier?: string
  password?: string
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Body
  const identifier = normalizeLegacyLoginIdentifier(body.identifier ?? body.email)
  const password = String(body.password ?? "")

  if (!identifier || !password) {
    res.status(400).json({ message: "Missing login or password" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const config = req.scope.resolve(ContainerRegistrationKeys.CONFIG_MODULE)

  const auth = await authenticateLegacyCustomerLogin({
    db,
    identifier,
    password,
  })

  if (!auth) {
    res.status(401).json({ message: "Invalid login or password" })
    return
  }

  const token = generateLegacyCustomerAuthToken({
    authIdentityId: auth.authIdentityId,
    config,
    customerId: auth.customerId,
  })

  res.status(200).json({ token })
}
