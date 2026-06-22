import {
  OFFLINE_METHODS,
  normalizeApproverEmails,
  isApprover,
  validateOfflinePayment,
  offlinePaymentMetadata,
  readOfflinePaymentMetadata,
} from "../gp-offline-payment"

describe("gp-offline-payment (#279/#282)", () => {
  describe("approver allowlist", () => {
    it("parses a mixed-delimiter env list, lowercased", () => {
      expect(
        normalizeApproverEmails("Peter@gp.com, avi@gp.com julie@gp.com; not-an-email")
      ).toEqual(["peter@gp.com", "avi@gp.com", "julie@gp.com"])
    })

    it("authorizes only listed approvers, case-insensitively", () => {
      const list = normalizeApproverEmails("peter@gp.com,avi@gp.com,julie@gp.com")
      expect(isApprover("AVI@gp.com", list)).toBe(true)
      expect(isApprover("chris@gp.com", list)).toBe(false)
      expect(isApprover("", list)).toBe(false)
      expect(isApprover("avi@gp.com", [])).toBe(false) // empty allowlist = nobody
    })
  })

  describe("validateOfflinePayment", () => {
    it("normalizes a valid approval (methods as array)", () => {
      const r = validateOfflinePayment({
        approved: true,
        methods: ["zelle", "wire"],
        credit_limit: 2500,
        payment_terms: "Net 10",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      expect(r.normalized).toEqual({
        approved: true,
        methods: ["zelle", "wire"],
        credit_limit: 2500,
        payment_terms: "Net 10",
      })
    })

    it("accepts methods as a comma string and de-dups", () => {
      const r = validateOfflinePayment({
        approved: true,
        methods: "check, check, wire",
        credit_limit: "1000",
        payment_terms: "Net 10",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      expect(r.normalized.methods).toEqual(["check", "wire"])
      expect(r.normalized.credit_limit).toBe(1000)
    })

    it("rejects an approval with no method, a bad method, a non-positive limit, or no terms", () => {
      expect(
        validateOfflinePayment({ approved: true, methods: [], credit_limit: 1000, payment_terms: "Net 10" })
          .errors.methods
      ).toBeDefined()
      expect(
        validateOfflinePayment({ approved: true, methods: ["paypal"], credit_limit: 1000, payment_terms: "Net 10" })
          .errors.methods
      ).toContain("paypal")
      expect(
        validateOfflinePayment({ approved: true, methods: ["zelle"], credit_limit: 0, payment_terms: "Net 10" })
          .errors.credit_limit
      ).toBeDefined()
      expect(
        validateOfflinePayment({ approved: true, methods: ["zelle"], credit_limit: 1000, payment_terms: "" })
          .errors.payment_terms
      ).toBeDefined()
    })

    it("clears all fields when un-approving (revoke)", () => {
      const r = validateOfflinePayment({
        approved: false,
        methods: ["zelle"],
        credit_limit: 5000,
        payment_terms: "Net 30",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      expect(r.normalized).toEqual({
        approved: false,
        methods: [],
        credit_limit: 0,
        payment_terms: null,
      })
    })
  })

  describe("metadata round-trip", () => {
    it("writes and reads the customer metadata shape", () => {
      const r = validateOfflinePayment({
        approved: true,
        methods: ["zelle", "check"],
        credit_limit: 11750,
        payment_terms: "Net 10",
      })
      expect(r.valid).toBe(true)
      if (!r.valid) return
      const meta = offlinePaymentMetadata(r.normalized)
      expect(meta).toEqual({
        gp_offline_payment_approved: true,
        gp_offline_methods: ["zelle", "check"],
        gp_credit_limit: 11750,
        gp_payment_terms: "Net 10",
      })
      expect(readOfflinePaymentMetadata(meta)).toEqual(r.normalized)
    })

    it("reads a default (unapproved) state from empty metadata", () => {
      expect(readOfflinePaymentMetadata({})).toEqual({
        approved: false,
        methods: [],
        credit_limit: 0,
        payment_terms: null,
      })
    })
  })

  it("exposes the three launch methods", () => {
    expect(OFFLINE_METHODS).toEqual(["zelle", "check", "wire"])
  })
})
