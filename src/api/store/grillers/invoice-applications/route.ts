import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

import {
  validateInvoiceApplication,
  invoiceApplicationMetadata,
  readInvoiceApplicationStatus,
  type InvoiceApplicationInput,
} from "../../../../lib/gp-invoice-application"
import { metadataObject } from "../../../../lib/catch-weight-finalization"
import { emitOpsAlert } from "../../../../lib/ops-alert"

/**
 * #279 / #291 — self-serve B2B "pay by invoice" application intake.
 *
 * A logged-in customer applies for invoice (Net) terms. We store the application
 * (status = pending) on their customer metadata and instrument the event. An approver
 * (Peter / Avi / Julie) then reviews + approves via the admin offline-payment surface, which
 * sets the real terms + credit limit and (Phase 1b) writes them back to QuickBooks. Customer
 * auth is enforced by middleware (authenticate("customer", ...)).
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const customerId = (req as any).auth_context?.actor_id || null
  const logger = req.scope.resolve("logger") as
    | {
        info?: (m: string) => void
        warn?: (m: string) => void
        error?: (m: string) => void
      }
    | undefined

  if (!customerId) {
    return res.status(401).json({
      type: "not_authorized",
      message: "Please sign in to apply for invoice terms.",
    })
  }

  const result = validateInvoiceApplication(
    (req.body || {}) as InvoiceApplicationInput
  )
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

    // Already approved → nothing to apply for.
    if (
      existingMeta.gp_offline_payment_approved === true ||
      readInvoiceApplicationStatus(existingMeta) === "approved"
    ) {
      return res.status(409).json({
        type: "already_approved",
        message: "This account is already approved for invoice terms.",
      })
    }

    const submittedAt = new Date().toISOString()
    const metadata = {
      ...existingMeta,
      ...invoiceApplicationMetadata(result.normalized, submittedAt),
    }
    await customerModule.updateCustomers(customerId, { metadata })

    // Instrument the application (warehouse event). No PII beyond business name + customer id.
    void emitOpsAlert({
      alertKind: "b2b_invoice_application_submitted",
      severity: "info",
      path: "src/api/store/grillers/invoice-applications/route.ts",
      title: `New B2B invoice application: ${result.normalized.business_name}`,
      meta: {
        customer_id: customerId,
        business_name: result.normalized.business_name,
        requested_credit_limit: result.normalized.requested_credit_limit ?? "",
      },
      logger: logger as any,
    })

    logger?.info?.(
      `[invoice-application] customer ${customerId} applied (${result.normalized.business_name})`
    )

    return res.status(201).json({ status: "pending" })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger?.error?.(
      `[invoice-application] failed for ${customerId}: ${message}`
    )
    return res.status(500).json({
      type: "server_error",
      message: "Could not submit your application. Please try again.",
    })
  }
}
