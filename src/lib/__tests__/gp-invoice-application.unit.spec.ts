import {
  validateInvoiceApplication,
  invoiceApplicationMetadata,
  invoiceApplicationDecisionMetadata,
  readInvoiceApplicationStatus,
} from "../gp-invoice-application"

describe("gp-invoice-application validation (#291)", () => {
  it("requires business name, contact name, and a valid email", () => {
    const r = validateInvoiceApplication({})
    expect(r.valid).toBe(false)
    if (r.valid) return
    expect(r.errors.business_name).toBeDefined()
    expect(r.errors.contact_name).toBeDefined()
    expect(r.errors.contact_email).toBeDefined()
  })

  it("rejects a malformed email and a too-short phone", () => {
    const r = validateInvoiceApplication({
      business_name: "Beth Shalom",
      contact_name: "Tonya",
      contact_email: "not-an-email",
      contact_phone: "123",
    })
    expect(r.valid).toBe(false)
    if (r.valid) return
    expect(r.errors.contact_email).toBeDefined()
    expect(r.errors.contact_phone).toBeDefined()
  })

  it("rejects a non-positive requested limit and unknown methods", () => {
    const r = validateInvoiceApplication({
      business_name: "Deli 2 U",
      contact_name: "Sam",
      contact_email: "sam@deli2u.com",
      requested_credit_limit: "0",
      methods: ["zelle", "bitcoin"],
    })
    expect(r.valid).toBe(false)
    if (r.valid) return
    expect(r.errors.requested_credit_limit).toBeDefined()
    expect(r.errors.methods).toContain("bitcoin")
  })

  it("normalizes a valid application (currency limit, deduped methods, lowercased email)", () => {
    const r = validateInvoiceApplication({
      business_name: "  King David Center ",
      tax_id: "58-1234567",
      contact_name: "Rivka",
      contact_email: "RIVKA@KingDavid.org",
      contact_phone: "(404) 555-0143",
      requested_credit_limit: "$12,000",
      methods: ["zelle", "Zelle", "wire"],
      notes: "We order weekly for events.",
    })
    expect(r.valid).toBe(true)
    if (!r.valid) return
    expect(r.normalized).toMatchObject({
      business_name: "King David Center",
      tax_id: "58-1234567",
      contact_name: "Rivka",
      contact_email: "rivka@kingdavid.org",
      requested_credit_limit: 12000,
      methods: ["zelle", "wire"],
    })
  })

  it("allows a minimal application (no limit/phone/methods)", () => {
    const r = validateInvoiceApplication({
      business_name: "Avenue Catering",
      contact_name: "Lee",
      contact_email: "lee@avenue.com",
    })
    expect(r.valid).toBe(true)
    if (!r.valid) return
    expect(r.normalized.requested_credit_limit).toBeNull()
    expect(r.normalized.methods).toEqual([])
    expect(r.normalized.contact_phone).toBeNull()
  })

  it("shapes pending metadata and reads its status", () => {
    const r = validateInvoiceApplication({
      business_name: "Sosland",
      contact_name: "Pat",
      contact_email: "pat@sosland.com",
    })
    expect(r.valid).toBe(true)
    if (!r.valid) return
    const meta = invoiceApplicationMetadata(
      r.normalized,
      "2026-06-23T00:00:00.000Z"
    )
    expect(meta.gp_invoice_application_status).toBe("pending")
    expect(readInvoiceApplicationStatus(meta)).toBe("pending")
    expect((meta.gp_invoice_application as any).submitted_at).toBe(
      "2026-06-23T00:00:00.000Z"
    )
  })

  it("decision metadata records who and when", () => {
    const meta = invoiceApplicationDecisionMetadata(
      "approved",
      "avi@gp.com",
      "2026-06-23T01:00:00.000Z"
    )
    expect(meta).toMatchObject({
      gp_invoice_application_status: "approved",
      gp_invoice_application_decided_by: "avi@gp.com",
      gp_invoice_application_decided_at: "2026-06-23T01:00:00.000Z",
    })
  })

  it("readInvoiceApplicationStatus returns null for absent/garbage status", () => {
    expect(readInvoiceApplicationStatus({})).toBeNull()
    expect(
      readInvoiceApplicationStatus({ gp_invoice_application_status: "weird" })
    ).toBeNull()
    expect(readInvoiceApplicationStatus(null)).toBeNull()
  })
})
