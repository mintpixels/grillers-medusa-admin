import {
  US_STATES,
  isValidStateCode,
  formatUsPhone,
  buildCustomerCode,
  validateCreateCustomer,
  customerMetadataFromNormalized,
} from "../gp-customer-create"

describe("gp-customer-create (#277)", () => {
  describe("formatUsPhone", () => {
    it("formats a 10-digit number as xxx-yyy-zzzz", () => {
      expect(formatUsPhone("4045551234")).toBe("404-555-1234")
    })

    it("strips a leading country code and punctuation", () => {
      expect(formatUsPhone("+1 (404) 555-1234")).toBe("404-555-1234")
      expect(formatUsPhone("1.404.555.1234")).toBe("404-555-1234")
    })

    it("rejects incomplete or impossible numbers (snooper guard)", () => {
      expect(formatUsPhone("404555")).toBeNull() // too short
      expect(formatUsPhone("0005551234")).toBeNull() // invalid area code
      expect(formatUsPhone("4041551234")).toBeNull() // invalid exchange
      expect(formatUsPhone("")).toBeNull()
      expect(formatUsPhone("abcdefghij")).toBeNull()
    })
  })

  describe("buildCustomerCode", () => {
    it("builds Lastname, FirstName - ZIP", () => {
      expect(
        buildCustomerCode({ first_name: "Peter", last_name: "Swerdlow", postal_code: "30062" })
      ).toBe("Swerdlow, Peter - 30062")
    })

    it("extracts a 5-digit ZIP from ZIP+4", () => {
      expect(
        buildCustomerCode({ first_name: "Peter", last_name: "Swerdlow", postal_code: "30062-1234" })
      ).toBe("Swerdlow, Peter - 30062")
    })

    it("never uses the company name and tolerates a missing ZIP", () => {
      expect(buildCustomerCode({ first_name: "Peter", last_name: "Swerdlow" })).toBe(
        "Swerdlow, Peter"
      )
    })

    it("caps at 41 characters preserving the ZIP suffix", () => {
      const code = buildCustomerCode({
        first_name: "Maximiliana",
        last_name: "Vanderbilt-Worthingtonshire",
        postal_code: "30305",
      })
      expect(code.length).toBeLessThanOrEqual(41)
      expect(code.endsWith(" - 30305")).toBe(true)
    })
  })

  describe("isValidStateCode / US_STATES", () => {
    it("accepts official 2-letter codes (case-insensitive) and rejects others", () => {
      expect(isValidStateCode("GA")).toBe(true)
      expect(isValidStateCode("ga")).toBe(true)
      expect(isValidStateCode("DC")).toBe(true)
      expect(isValidStateCode("ZZ")).toBe(false)
      expect(isValidStateCode("Georgia")).toBe(false)
      expect(isValidStateCode("")).toBe(false)
    })

    it("includes all 50 states plus DC", () => {
      const codes = new Set(US_STATES.map((s) => s.code))
      expect(codes.size).toBe(US_STATES.length) // no duplicates
      expect(codes.has("DC")).toBe(true)
      // 50 states + DC at minimum
      expect(US_STATES.length).toBeGreaterThanOrEqual(51)
    })
  })

  describe("validateCreateCustomer", () => {
    const base = {
      first_name: "Peter",
      last_name: "Swerdlow",
      email: "peter@example.com",
      phone: "(404) 555-1234",
      phone_line_type: "mobile",
    }

    it("rejects blank first or last name", () => {
      const r = validateCreateCustomer({ ...base, first_name: "  ", last_name: "" })
      expect(r.valid).toBe(false)
      expect(r.errors.first_name).toBeDefined()
      expect(r.errors.last_name).toBeDefined()
    })

    it("rejects a blank or incomplete phone number", () => {
      expect(validateCreateCustomer({ ...base, phone: "" }).errors.phone).toBeDefined()
      expect(validateCreateCustomer({ ...base, phone: "404555" }).errors.phone).toBeDefined()
    })

    it("forces a mobile or landline choice", () => {
      expect(
        validateCreateCustomer({ ...base, phone_line_type: "" }).errors.phone_line_type
      ).toBeDefined()
      expect(
        validateCreateCustomer({ ...base, phone_line_type: "maybe" }).errors.phone_line_type
      ).toBeDefined()
    })

    it("requires a valid email", () => {
      expect(validateCreateCustomer({ ...base, email: "" }).errors.email).toBeDefined()
      expect(validateCreateCustomer({ ...base, email: "not-an-email" }).errors.email).toBeDefined()
    })

    it("normalizes a valid customer with formatted phone, mobile flag, and customer code", () => {
      const r = validateCreateCustomer({
        ...base,
        company_name: "Swerdlow Holdings LLC",
        postal_code: "30062",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      expect(r.normalized.phone).toBe("404-555-1234")
      expect(r.normalized.is_mobile).toBe(true)
      expect(r.normalized.email).toBe("peter@example.com")
      expect(r.normalized.company_name).toBe("Swerdlow Holdings LLC")
      // Company name must NOT leak into the customer code.
      expect(r.normalized.customer_code).toBe("Swerdlow, Peter - 30062")
      expect(r.normalized.customer_code).not.toContain("Holdings")
    })

    it("validates the ship-to address and constrains the state", () => {
      const bad = validateCreateCustomer({
        ...base,
        address_1: "123 Peachtree St",
        city: "Atlanta",
        province: "Georgia", // not a 2-letter code
        postal_code: "30303",
      })
      expect(bad.valid).toBe(false)
      expect(bad.errors.province).toBeDefined()

      const missingCity = validateCreateCustomer({
        ...base,
        address_1: "123 Peachtree St",
        province: "GA",
        postal_code: "30303",
      })
      expect(missingCity.valid).toBe(false)
      expect(missingCity.errors.city).toBeDefined()

      const good = validateCreateCustomer({
        ...base,
        address_1: "123 Peachtree St",
        city: "Atlanta",
        province: "ga",
        postal_code: "30303",
      })
      expect(good.valid).toBe(true)
      if (!good.valid) return
      expect(good.normalized.address).toMatchObject({
        address_1: "123 Peachtree St",
        city: "Atlanta",
        province: "GA",
        postal_code: "30303",
        country_code: "us",
        phone: "404-555-1234",
      })
    })

    it("validates alternate-contact fields when provided", () => {
      const bad = validateCreateCustomer({
        ...base,
        alt_first_name: "Avi",
        alt_phone: "12345",
        alt_email: "nope",
      })
      expect(bad.valid).toBe(false)
      expect(bad.errors.alt_phone).toBeDefined()
      expect(bad.errors.alt_email).toBeDefined()

      const good = validateCreateCustomer({
        ...base,
        alt_first_name: "Avi",
        alt_last_name: "Swerdlow",
        alt_phone: "404-555-9999",
        alt_phone_line_type: "landline",
        alt_email: "avi@example.com",
      })
      expect(good.valid).toBe(true)
      if (!good.valid) return
      expect(good.normalized.alt_contact).toMatchObject({
        first_name: "Avi",
        last_name: "Swerdlow",
        email: "avi@example.com",
        phone: "404-555-9999",
        is_mobile: false,
      })
    })
  })

  describe("customerMetadataFromNormalized", () => {
    it("stores the mobile flag, customer code, and alt contact", () => {
      const r = validateCreateCustomer({
        first_name: "Peter",
        last_name: "Swerdlow",
        email: "peter@example.com",
        phone: "404-555-1234",
        phone_line_type: "landline",
        postal_code: "30062",
        alt_first_name: "Avi",
        alt_phone: "404-555-9999",
        alt_phone_line_type: "mobile",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      const meta = customerMetadataFromNormalized(r.normalized)
      expect(meta).toMatchObject({
        gp_customer_code: "Swerdlow, Peter - 30062",
        gp_phone_is_mobile: false,
        gp_phone_line_type: "landline",
        gp_created_via: "staff_create_customer",
        gp_alt_contact: {
          first_name: "Avi",
          phone: "404-555-9999",
          is_mobile: true,
        },
      })
    })
  })
})
