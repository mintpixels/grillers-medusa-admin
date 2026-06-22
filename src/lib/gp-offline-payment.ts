/**
 * #279 / #282 — approved B2B "pay by invoice" account model.
 *
 * Pure, framework-free helpers shared by the admin API and (later) the Create-Customer UI:
 * validate/normalize the offline-payment fields on a customer, gate who may approve an account
 * (the Peter / Avi / Julie allowlist), and shape the metadata persisted on the customer. B2C
 * customers never carry any of these fields.
 */

export type OfflineMethod = "zelle" | "check" | "wire"
export const OFFLINE_METHODS: OfflineMethod[] = ["zelle", "check", "wire"]

function text(value: unknown): string {
  return String(value ?? "").trim()
}

function asBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1"
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "string" ? Number(value) : (value as number)
  return Number.isFinite(n) ? (n as number) : null
}

/** Parse the approver allowlist from a comma/space/semicolon-separated env string. */
export function normalizeApproverEmails(raw: unknown): string[] {
  return text(raw)
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"))
}

/** Only the configured approvers (Peter / Avi / Julie) may approve an account. Empty list = nobody. */
export function isApprover(email: unknown, allowlist: string[]): boolean {
  const e = text(email).toLowerCase()
  return e !== "" && allowlist.includes(e)
}

export type OfflinePaymentInput = {
  approved?: unknown
  methods?: unknown // array or comma-separated string
  credit_limit?: unknown
  payment_terms?: unknown // e.g. "Net 10"
}

export type NormalizedOfflinePayment = {
  approved: boolean
  methods: OfflineMethod[]
  credit_limit: number
  payment_terms: string | null
}

export type OfflinePaymentValidation =
  | { valid: true; errors: Record<string, never>; normalized: NormalizedOfflinePayment }
  | { valid: false; errors: Record<string, string>; normalized: null }

function rawMethods(value: unknown): string[] {
  const list = Array.isArray(value) ? value : text(value).split(/[,;]+/)
  return list.map((m) => String(m ?? "").trim().toLowerCase()).filter(Boolean)
}

/**
 * Validate an approval. When approving, the account must have at least one valid method, a
 * positive credit limit, and terms. Un-approving (revoking) clears all of it.
 */
export function validateOfflinePayment(
  input: OfflinePaymentInput
): OfflinePaymentValidation {
  const errors: Record<string, string> = {}
  const approved = asBool(input.approved)

  let methods: OfflineMethod[] = []
  let creditLimit = 0
  let terms: string | null = null

  if (approved) {
    const raw = rawMethods(input.methods)
    const invalid = raw.filter((m) => !OFFLINE_METHODS.includes(m as OfflineMethod))
    methods = raw.filter((m): m is OfflineMethod =>
      OFFLINE_METHODS.includes(m as OfflineMethod)
    )
    // de-dup while preserving order
    methods = methods.filter((m, i) => methods.indexOf(m) === i)
    if (invalid.length > 0) {
      errors.methods = `Unknown payment method(s): ${invalid.join(", ")}. Allowed: zelle, check, wire.`
    } else if (methods.length === 0) {
      errors.methods = "Select at least one payment method (Zelle, check, or wire)."
    }

    creditLimit = numericOrNull(input.credit_limit) ?? -1
    if (creditLimit <= 0) {
      errors.credit_limit = "Enter a credit limit greater than $0."
    }

    terms = text(input.payment_terms) || null
    if (!terms) {
      errors.payment_terms = "Enter the payment terms (e.g. Net 10)."
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, normalized: null }
  }

  return {
    valid: true,
    errors: {},
    normalized: {
      approved,
      methods: approved ? methods : [],
      credit_limit: approved ? creditLimit : 0,
      payment_terms: approved ? terms : null,
    },
  }
}

/** The customer metadata keys this feature owns. */
export function offlinePaymentMetadata(
  n: NormalizedOfflinePayment
): Record<string, unknown> {
  return {
    gp_offline_payment_approved: n.approved,
    gp_offline_methods: n.methods,
    gp_credit_limit: n.credit_limit,
    gp_payment_terms: n.payment_terms,
  }
}

/** Read the current offline-payment state off a customer's metadata (for audit diffing). */
export function readOfflinePaymentMetadata(
  metadata: unknown
): NormalizedOfflinePayment {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}
  const methods = Array.isArray(m.gp_offline_methods)
    ? (m.gp_offline_methods.filter((x) => OFFLINE_METHODS.includes(x as OfflineMethod)) as OfflineMethod[])
    : []
  return {
    approved: asBool(m.gp_offline_payment_approved),
    methods,
    credit_limit: numericOrNull(m.gp_credit_limit) ?? 0,
    payment_terms: text(m.gp_payment_terms) || null,
  }
}
