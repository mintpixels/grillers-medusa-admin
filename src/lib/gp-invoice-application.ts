/**
 * #279 / #291 — self-serve B2B "pay by invoice" application.
 *
 * Pure, framework-free helpers shared by the storefront application form, the store intake
 * API, and the admin approver-review surface: validate/normalize what a business submits when
 * applying for invoice (Net) terms, and shape the metadata persisted on the Medusa customer.
 * The actual approval (terms + credit limit) is set by an approver via gp-offline-payment;
 * this module only models the application and its lifecycle status. Must stay isomorphic (no
 * node-only deps) so the admin browser bundle can import it.
 */

import { OFFLINE_METHODS, type OfflineMethod } from "./gp-offline-payment"

export type InvoiceApplicationStatus = "pending" | "approved" | "declined"

function text(value: unknown): string {
  return String(value ?? "").trim()
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n =
    typeof value === "string"
      ? Number(String(value).replace(/[$,]/g, ""))
      : (value as number)
  return Number.isFinite(n) ? (n as number) : null
}

// Dependency-free email check (kept simple on purpose; isomorphic).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function methodsList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : text(value).split(/[,;]+/)
  return list.map((m) => String(m ?? "").trim().toLowerCase()).filter(Boolean)
}

export type InvoiceApplicationInput = {
  business_name?: unknown
  tax_id?: unknown
  contact_name?: unknown
  contact_email?: unknown
  contact_phone?: unknown
  requested_credit_limit?: unknown
  methods?: unknown // array or comma-separated string
  notes?: unknown
}

export type NormalizedInvoiceApplication = {
  business_name: string
  tax_id: string | null
  contact_name: string
  contact_email: string
  contact_phone: string | null
  requested_credit_limit: number | null
  methods: OfflineMethod[]
  notes: string | null
}

export type InvoiceApplicationValidation =
  | {
      valid: true
      errors: Record<string, never>
      normalized: NormalizedInvoiceApplication
    }
  | { valid: false; errors: Record<string, string>; normalized: null }

/**
 * Validate a self-serve invoice-terms application. Business name, contact name, and a valid
 * contact email are required. Tax id, phone, requested credit limit, preferred methods, and
 * notes are optional but validated when present. The requested limit is advisory only — the
 * approver sets the real limit (in QuickBooks).
 */
export function validateInvoiceApplication(
  input: InvoiceApplicationInput
): InvoiceApplicationValidation {
  const errors: Record<string, string> = {}

  const business_name = text(input.business_name)
  if (!business_name) errors.business_name = "Enter your business name."

  const contact_name = text(input.contact_name)
  if (!contact_name) errors.contact_name = "Enter a contact name."

  const contact_email = text(input.contact_email).toLowerCase()
  if (!contact_email) errors.contact_email = "Enter a contact email."
  else if (!EMAIL_RE.test(contact_email))
    errors.contact_email = "Enter a valid email address."

  const contact_phone = text(input.contact_phone) || null
  if (contact_phone && contact_phone.replace(/\D/g, "").length < 10) {
    errors.contact_phone = "Enter a valid phone number."
  }

  const tax_id = text(input.tax_id) || null

  let requested_credit_limit: number | null = null
  if (text(input.requested_credit_limit) !== "") {
    const n = numericOrNull(input.requested_credit_limit)
    if (n === null || n <= 0) {
      errors.requested_credit_limit =
        "Enter a requested credit limit greater than $0, or leave it blank."
    } else {
      requested_credit_limit = n
    }
  }

  const rawMethods = methodsList(input.methods)
  const invalidMethods = rawMethods.filter(
    (m) => !OFFLINE_METHODS.includes(m as OfflineMethod)
  )
  const valid = rawMethods.filter((m): m is OfflineMethod =>
    OFFLINE_METHODS.includes(m as OfflineMethod)
  )
  const methods = valid.filter((m, i) => valid.indexOf(m) === i)
  if (invalidMethods.length > 0) {
    errors.methods = `Unknown payment method(s): ${invalidMethods.join(", ")}. Allowed: zelle, check, wire.`
  }

  const notes = text(input.notes) || null

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, normalized: null }
  }

  return {
    valid: true,
    errors: {},
    normalized: {
      business_name,
      tax_id,
      contact_name,
      contact_email,
      contact_phone,
      requested_credit_limit,
      methods,
      notes,
    },
  }
}

/**
 * Metadata for a freshly submitted (pending) application. `submittedAt` is passed in (ISO)
 * rather than read from the clock here so the function stays pure and testable.
 */
export function invoiceApplicationMetadata(
  n: NormalizedInvoiceApplication,
  submittedAt: string
): Record<string, unknown> {
  return {
    gp_invoice_application_status: "pending" as InvoiceApplicationStatus,
    gp_invoice_application: {
      business_name: n.business_name,
      tax_id: n.tax_id,
      contact_name: n.contact_name,
      contact_email: n.contact_email,
      contact_phone: n.contact_phone,
      requested_credit_limit: n.requested_credit_limit,
      methods: n.methods,
      notes: n.notes,
      submitted_at: submittedAt,
    },
  }
}

/** The metadata patch an approver's decision writes (status + who/when), for the admin route. */
export function invoiceApplicationDecisionMetadata(
  decision: "approved" | "declined",
  decidedBy: string,
  decidedAt: string
): Record<string, unknown> {
  return {
    gp_invoice_application_status: decision as InvoiceApplicationStatus,
    gp_invoice_application_decided_by: decidedBy,
    gp_invoice_application_decided_at: decidedAt,
  }
}

export function readInvoiceApplicationStatus(
  metadata: unknown
): InvoiceApplicationStatus | null {
  const m =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : {}
  const s = text(m.gp_invoice_application_status)
  return s === "pending" || s === "approved" || s === "declined" ? s : null
}
