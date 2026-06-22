import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import {
  validateOfflinePayment,
  offlinePaymentMetadata,
  readOfflinePaymentMetadata,
  normalizeApproverEmails,
  isApprover,
  type OfflinePaymentInput,
} from "../../../../../../lib/gp-offline-payment"
import {
  appendStaffAudit,
  metadataObject,
} from "../../../../../../lib/catch-weight-finalization"

/**
 * #279 / #282 — set/clear a customer's approved offline-payment ("pay by invoice") terms.
 *
 * Only the configured approvers (Peter / Avi / Julie, via GP_OFFLINE_PAYMENT_APPROVER_EMAILS)
 * may call this. Every change is validated and written to the customer's staff_audit_log with
 * the before/after so credit-terms changes are accountable.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = req.params.id
  const actorId = (req as any).auth_context?.actor_id || null
  const logger = req.scope.resolve("logger") as
    | { info?: (m: string) => void; error?: (m: string) => void }
    | undefined

  const allowlist = normalizeApproverEmails(
    process.env.GP_OFFLINE_PAYMENT_APPROVER_EMAILS
  )
  if (allowlist.length === 0) {
    return res.status(403).json({
      type: "not_authorized",
      message:
        "Offline-payment approvals are not enabled (set GP_OFFLINE_PAYMENT_APPROVER_EMAILS).",
    })
  }

  // Resolve the acting admin user's email for the approver allowlist.
  let actorEmail = ""
  try {
    const userModule = req.scope.resolve(Modules.USER) as any
    const user = actorId
      ? await userModule.retrieveUser(actorId, { select: ["id", "email"] })
      : null
    actorEmail = user?.email || ""
  } catch {
    actorEmail = ""
  }

  if (!isApprover(actorEmail, allowlist)) {
    return res.status(403).json({
      type: "not_authorized",
      message:
        "You are not authorized to approve offline-payment accounts. Ask a designated approver (Peter, Avi, or Julie).",
    })
  }

  const result = validateOfflinePayment((req.body || {}) as OfflinePaymentInput)
  if (!result.valid) {
    return res.status(400).json({
      type: "invalid_data",
      message: "Please correct the highlighted fields.",
      errors: result.errors,
    })
  }

  const customerModule = req.scope.resolve(Modules.CUSTOMER) as any

  try {
    const customer = await customerModule.retrieveCustomer(customerId, {
      select: ["id", "metadata"],
    })
    const existingMeta = metadataObject(customer?.metadata)
    const before = readOfflinePaymentMetadata(existingMeta)
    const after = result.normalized

    const metadata = appendStaffAudit(
      { ...existingMeta, ...offlinePaymentMetadata(after) },
      {
        action: "offline_payment_terms_updated",
        staff_actor_id: actorId,
        staff_actor_email: actorEmail,
        before,
        after,
      }
    )

    await customerModule.updateCustomers(customerId, { metadata })
    logger?.info?.(
      `[offline-payment] ${actorEmail} set customer ${customerId} approved=${after.approved} limit=${after.credit_limit}`
    )

    return res.status(200).json({ customer_id: customerId, offline_payment: after })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger?.error?.(`[offline-payment] failed for ${customerId}: ${message}`)
    return res.status(500).json({
      type: "server_error",
      message: "Could not update the account's payment terms.",
    })
  }
}
