import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  authenticateLegacyCustomerLogin,
  generateLegacyCustomerAuthToken,
  normalizeLegacyLoginIdentifier,
} from "../../../../lib/legacy-customer-auth"
import { emitCustomerAuthRouteFailureAlert } from "../../../../lib/customer-auth-route-alerts"

const ROUTE_PATH = "src/api/store/legacy-auth/login/route.ts"

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

  let logger:
    | {
        error?: (message: string) => void
        warn?: (message: string) => void
      }
    | undefined
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[legacy-auth] login failed: ${message}`)
    await emitCustomerAuthRouteFailureAlert({
      req,
      action: "legacy_login",
      path: ROUTE_PATH,
      identifier,
      error,
      logger,
    })
    res.status(500).json({ message: "Could not sign in. Please try again." })
  }
}
