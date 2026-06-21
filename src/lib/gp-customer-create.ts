/**
 * #277 — staff "Create a customer account" validation + normalization.
 *
 * Pure, framework-free helpers so the admin UI and the admin API both enforce the same
 * rules: non-blank names, a required mobile/landline flag, an auto-formatted + validated
 * `xxx-yyy-zzzz` phone, a State drop-down constrained to official 2-letter codes, the
 * QuickBooks-style customer code (Lastname, FirstName - ZIP — never the company name), and
 * optional alternate-contact fields. The company name is a reference field only.
 */

export type LineType = "mobile" | "landline"

export const US_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "U.S. Virgin Islands" },
  { code: "GU", name: "Guam" },
  { code: "AS", name: "American Samoa" },
  { code: "MP", name: "Northern Mariana Islands" },
]

const STATE_CODES = new Set(US_STATES.map((s) => s.code))

export function isValidStateCode(value: unknown): boolean {
  return typeof value === "string" && STATE_CODES.has(value.trim().toUpperCase())
}

function text(value: unknown): string {
  return String(value ?? "").trim()
}

/**
 * Reduce any input to a valid 10-digit US/NANP number, or null. Mirrors the validity rule in
 * communications/phone-intelligence (`normalizePhoneForIntelligence`) exactly — kept inline so
 * this module stays free of node-only dependencies and can run in the admin (browser) bundle.
 */
function normalizedUsDigits(value: unknown): string | null {
  let digits = text(value).replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1)
  }
  return digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null
}

/** Format any input into the canonical `xxx-yyy-zzzz` display string, or null if not a valid US number. */
export function formatUsPhone(value: unknown): string | null {
  const digits = normalizedUsDigits(value)
  if (!digits) {
    return null
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

function fiveDigitZip(value: unknown): string {
  const digits = text(value).replace(/\D/g, "")
  return digits.slice(0, 5)
}

/**
 * The customer code is "Lastname, FirstName - ZIP" (matching the QuickBooks customer-list
 * convention in grilers-pride-sync CustomerSync::quickBooksCustomerName). The company name is
 * never used here. QuickBooks caps the customer Name at 41 chars, preserving the " - ZIP" suffix.
 */
export function buildCustomerCode(params: {
  first_name?: unknown
  last_name?: unknown
  postal_code?: unknown
}): string {
  const first = text(params.first_name).replace(/[\r\n\t:]+/g, " ").replace(/\s+/g, " ")
  const last = text(params.last_name).replace(/[\r\n\t:]+/g, " ").replace(/\s+/g, " ")
  const zip = fiveDigitZip(params.postal_code)

  let name: string
  if (last && first) {
    name = `${last}, ${first}`
  } else if (last) {
    name = last
  } else if (first) {
    name = first
  } else {
    name = ""
  }

  if (!zip) {
    return name.slice(0, 41)
  }

  const suffix = ` - ${zip}`
  const maxNameLength = Math.max(1, 41 - suffix.length)
  return `${name.slice(0, maxNameLength)}${suffix}`
}

export type AddressInput = {
  address_1?: unknown
  address_2?: unknown
  city?: unknown
  province?: unknown
  postal_code?: unknown
  country_code?: unknown
}

export type CreateCustomerInput = {
  first_name?: unknown
  last_name?: unknown
  email?: unknown
  phone?: unknown
  phone_line_type?: unknown
  company_name?: unknown
  // ship-to / primary address
  address_1?: unknown
  address_2?: unknown
  city?: unknown
  province?: unknown
  postal_code?: unknown
  country_code?: unknown
  // alternate contact
  alt_first_name?: unknown
  alt_last_name?: unknown
  alt_email?: unknown
  alt_phone?: unknown
  alt_phone_line_type?: unknown
}

export type NormalizedAltContact = {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  is_mobile: boolean | null
}

export type NormalizedCustomer = {
  first_name: string
  last_name: string
  email: string
  phone: string
  is_mobile: boolean
  company_name: string | null
  customer_code: string
  address: {
    first_name: string
    last_name: string
    company: string | null
    address_1: string
    address_2: string | null
    city: string | null
    province: string
    postal_code: string
    country_code: string
    phone: string
  } | null
  alt_contact: NormalizedAltContact | null
}

export type ValidationResult =
  | { valid: true; errors: Record<string, never>; normalized: NormalizedCustomer }
  | { valid: false; errors: Record<string, string>; normalized: null }

function emailValid(value: string): boolean {
  // Intentionally permissive: requires a local part, an @, and a dotted domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function hasAnyAddressField(input: CreateCustomerInput): boolean {
  // postal_code is intentionally excluded: it doubles as the customer-code ZIP, so a staff
  // member can record a ZIP for the code without being forced to enter a full ship-to address.
  return Boolean(
    text(input.address_1) ||
      text(input.address_2) ||
      text(input.city) ||
      text(input.province)
  )
}

function hasAnyAltField(input: CreateCustomerInput): boolean {
  return Boolean(
    text(input.alt_first_name) ||
      text(input.alt_last_name) ||
      text(input.alt_email) ||
      text(input.alt_phone)
  )
}

export function validateCreateCustomer(
  input: CreateCustomerInput
): ValidationResult {
  const errors: Record<string, string> = {}

  const firstName = text(input.first_name)
  const lastName = text(input.last_name)
  if (!firstName) {
    errors.first_name = "First name is required."
  }
  if (!lastName) {
    errors.last_name = "Last name is required."
  }

  const email = text(input.email).toLowerCase()
  if (!email) {
    errors.email = "Email is required."
  } else if (!emailValid(email)) {
    errors.email = "Enter a valid email address."
  }

  // Phone is required, must be a complete, valid US number, and auto-formats to xxx-yyy-zzzz.
  const rawPhone = text(input.phone)
  const phone = formatUsPhone(rawPhone)
  if (!rawPhone) {
    errors.phone = "Phone number is required."
  } else if (!phone) {
    errors.phone = "Enter a complete, valid 10-digit US phone number (xxx-yyy-zzzz)."
  }

  // Mobile vs landline is a forced choice.
  const lineType = text(input.phone_line_type).toLowerCase()
  if (lineType !== "mobile" && lineType !== "landline") {
    errors.phone_line_type =
      "Select whether the phone number is a mobile or a landline."
  }

  // Address is optional, but if any field is provided it must be complete + a valid state.
  let address: NormalizedCustomer["address"] = null
  const provideAddress = hasAnyAddressField(input)
  if (provideAddress) {
    const address1 = text(input.address_1)
    const city = text(input.city)
    const province = text(input.province).toUpperCase()
    const postalCode = fiveDigitZip(input.postal_code)
    if (!address1) {
      errors.address_1 = "Street address is required for the ship-to address."
    }
    if (!city) {
      errors.city = "City is required for the ship-to address."
    }
    if (!province) {
      errors.province = "Select a state."
    } else if (!isValidStateCode(province)) {
      errors.province = "Select a valid 2-letter state."
    }
    if (!postalCode) {
      errors.postal_code = "A 5-digit ZIP code is required for the ship-to address."
    }

    if (address1 && city && isValidStateCode(province) && postalCode) {
      address = {
        first_name: firstName,
        last_name: lastName,
        company: text(input.company_name) || null,
        address_1: address1,
        address_2: text(input.address_2) || null,
        city,
        province,
        postal_code: postalCode,
        country_code: text(input.country_code).toLowerCase() || "us",
        phone: phone || rawPhone,
      }
    }
  }

  // Alternate contact is optional; validate only what is provided.
  let altContact: NormalizedAltContact | null = null
  if (hasAnyAltField(input)) {
    const altEmailRaw = text(input.alt_email).toLowerCase()
    if (altEmailRaw && !emailValid(altEmailRaw)) {
      errors.alt_email = "Enter a valid alternate email address."
    }
    const altPhoneRaw = text(input.alt_phone)
    const altPhone = altPhoneRaw ? formatUsPhone(altPhoneRaw) : null
    if (altPhoneRaw && !altPhone) {
      errors.alt_phone =
        "Enter a complete, valid 10-digit alternate phone number (xxx-yyy-zzzz)."
    }
    const altLineType = text(input.alt_phone_line_type).toLowerCase()

    altContact = {
      first_name: text(input.alt_first_name) || null,
      last_name: text(input.alt_last_name) || null,
      email: altEmailRaw || null,
      phone: altPhone,
      is_mobile:
        altLineType === "mobile" ? true : altLineType === "landline" ? false : null,
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors, normalized: null }
  }

  const normalized: NormalizedCustomer = {
    first_name: firstName,
    last_name: lastName,
    email,
    phone: phone as string,
    is_mobile: lineType === "mobile",
    company_name: text(input.company_name) || null,
    customer_code: buildCustomerCode({
      first_name: firstName,
      last_name: lastName,
      postal_code: address?.postal_code ?? input.postal_code,
    }),
    address,
    alt_contact: altContact,
  }

  return { valid: true, errors: {}, normalized }
}

/**
 * The customer metadata blob persisted on the Medusa customer. Keeps the staff-set fields the
 * built-in entity has no native column for (mobile/landline flag, alternate contact), plus the
 * customer code so downstream surfaces don't have to recompute it.
 */
export function customerMetadataFromNormalized(
  normalized: NormalizedCustomer
): Record<string, unknown> {
  return {
    gp_customer_code: normalized.customer_code,
    gp_phone_is_mobile: normalized.is_mobile,
    gp_phone_line_type: normalized.is_mobile ? "mobile" : "landline",
    gp_created_via: "staff_create_customer",
    ...(normalized.alt_contact
      ? {
          gp_alt_contact: {
            first_name: normalized.alt_contact.first_name,
            last_name: normalized.alt_contact.last_name,
            email: normalized.alt_contact.email,
            phone: normalized.alt_contact.phone,
            is_mobile: normalized.alt_contact.is_mobile,
          },
        }
      : {}),
  }
}
