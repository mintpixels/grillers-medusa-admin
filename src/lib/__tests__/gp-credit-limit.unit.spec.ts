import { evaluateCreditLimit, creditHoldMetadata } from "../gp-credit-limit"

describe("gp-credit-limit evaluation (#286)", () => {
  it("is within limit when outstanding + order stays at or under the limit", () => {
    const e = evaluateCreditLimit({
      creditLimit: 5000,
      outstanding: 1500,
      orderTotal: 2000,
    })
    expect(e.projectedExposure).toBe(3500)
    expect(e.withinLimit).toBe(true)
    expect(e.overBy).toBe(0)
    expect(e.requiresSecondApproval).toBe(false)
  })

  it("is exactly at the limit (boundary) and still within", () => {
    const e = evaluateCreditLimit({
      creditLimit: 5000,
      outstanding: 3000,
      orderTotal: 2000,
    })
    expect(e.withinLimit).toBe(true)
    expect(e.requiresSecondApproval).toBe(false)
  })

  it("requires a second approval when the order pushes over the limit", () => {
    const e = evaluateCreditLimit({
      creditLimit: 5000,
      outstanding: 4000,
      orderTotal: 2000,
    })
    expect(e.projectedExposure).toBe(6000)
    expect(e.withinLimit).toBe(false)
    expect(e.overBy).toBe(1000)
    expect(e.requiresSecondApproval).toBe(true)
  })

  it("parses currency-formatted strings", () => {
    const e = evaluateCreditLimit({
      creditLimit: "$5,000",
      outstanding: "1,000",
      orderTotal: "500",
    })
    expect(e.creditLimit).toBe(5000)
    expect(e.withinLimit).toBe(true)
  })

  it("fails safe (requires approval) when no limit is set", () => {
    const e = evaluateCreditLimit({
      creditLimit: null,
      outstanding: 0,
      orderTotal: 100,
    })
    expect(e.creditLimit).toBeNull()
    expect(e.withinLimit).toBe(false)
    expect(e.requiresSecondApproval).toBe(true)
  })

  it("fails safe when the limit is zero or negative", () => {
    expect(
      evaluateCreditLimit({ creditLimit: 0, outstanding: 0, orderTotal: 100 })
        .requiresSecondApproval
    ).toBe(true)
    expect(
      evaluateCreditLimit({ creditLimit: -5, outstanding: 0, orderTotal: 100 })
        .requiresSecondApproval
    ).toBe(true)
  })

  it("treats negative/garbage outstanding + total as 0", () => {
    const e = evaluateCreditLimit({
      creditLimit: 1000,
      outstanding: -500,
      orderTotal: "abc",
    })
    expect(e.outstanding).toBe(0)
    expect(e.orderTotal).toBe(0)
    expect(e.withinLimit).toBe(true)
  })

  it("shapes a credit-hold metadata marker", () => {
    const e = evaluateCreditLimit({
      creditLimit: 5000,
      outstanding: 4500,
      orderTotal: 1000,
    })
    const meta = creditHoldMetadata(e, "2026-06-23T00:00:00.000Z")
    expect(meta.gp_credit_hold).toMatchObject({
      held: true,
      reason: "credit_limit_exceeded",
      credit_limit: 5000,
      over_by: 500,
      projected_exposure: 5500,
      placed_at: "2026-06-23T00:00:00.000Z",
    })
  })
})
