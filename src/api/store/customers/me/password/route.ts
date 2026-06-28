import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateCustomerEmailpassPassword } from "../../../../../lib/customer-password-update"
import { emitCustomerAuthRouteFailureAlert } from "../../../../../lib/customer-auth-route-alerts"

const ROUTE_PATH = "src/api/store/customers/me/password/route.ts"

type Body = {
  current_password?: string
  new_password?: string
}

function normalizedPassword(value: unknown) {
  return typeof value === "string" ? value : ""
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const body = (req.body ?? {}) as Body
  const currentPassword = normalizedPassword(body.current_password)
  const newPassword = normalizedPassword(body.new_password)

  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: "Current and new password are required" })
    return
  }

  if (newPassword.length < 8) {
    res
      .status(400)
      .json({ message: "New password must be at least 8 characters" })
    return
  }

  if (currentPassword === newPassword) {
    res
      .status(400)
      .json({ message: "New password must be different from current password" })
    return
  }

  let result: Awaited<ReturnType<typeof updateCustomerEmailpassPassword>>

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    result = await updateCustomerEmailpassPassword({
      currentPassword,
      customerId,
      db,
      newPassword,
      sessionAuthIdentityId: (req as any).auth_context?.auth_identity_id,
    })
  } catch (error) {
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
    const message = error instanceof Error ? error.message : String(error)
    logger?.error?.(`[customer-password] update failed: ${message}`)
    await emitCustomerAuthRouteFailureAlert({
      req,
      action: "password_change",
      path: ROUTE_PATH,
      error,
      logger,
    })
    res
      .status(500)
      .json({ message: "Could not update password. Please try again." })
    return
  }

  if (result.status === "updated") {
    res.status(200).json({ ok: true })
    return
  }

  if (result.status === "ambiguous") {
    res.status(409).json({
      message:
        "We could not safely choose which login to update. Please reset your password by email.",
    })
    return
  }

  if (result.status === "no_auth_identity") {
    res.status(400).json({
      message: "This account needs a password reset before changing password.",
    })
    return
  }

  res.status(401).json({ message: "Current password is incorrect" })
}
