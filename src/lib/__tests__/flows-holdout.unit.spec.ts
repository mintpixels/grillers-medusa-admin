import { isHoldout } from "../communications/flows"

describe("flow holdout assignment", () => {
  const flow = (overrides: Record<string, any> = {}) => ({
    key: "winback-lapsed",
    metadata: {},
    ...overrides,
  })

  it("is deterministic per profile+flow", () => {
    for (let i = 0; i < 50; i++) {
      const profileId = `gpcprof_${i}`
      const first = isHoldout(profileId, flow())
      const second = isHoldout(profileId, flow())
      expect(second).toBe(first)
    }
  })

  it("assigns roughly the configured percentage", () => {
    let held = 0
    const n = 5000
    for (let i = 0; i < n; i++) {
      if (isHoldout(`gpcprof_${i}`, flow())) held += 1
    }
    const pct = (held / n) * 100
    expect(pct).toBeGreaterThan(7)
    expect(pct).toBeLessThan(13)
  })

  it("honors per-flow override", () => {
    let held = 0
    const n = 2000
    for (let i = 0; i < n; i++) {
      if (isHoldout(`gpcprof_${i}`, flow({ metadata: { holdout_pct: 25 } })))
        held += 1
    }
    const pct = (held / n) * 100
    expect(pct).toBeGreaterThan(20)
    expect(pct).toBeLessThan(30)
  })

  it("holdout_pct 0 disables holdouts", () => {
    for (let i = 0; i < 200; i++) {
      expect(isHoldout(`gpcprof_${i}`, flow({ metadata: { holdout_pct: 0 } }))).toBe(
        false
      )
    }
  })

  it("assignment is independent across flows", () => {
    // A profile held out of one flow must not be systematically held out
    // of another — check the overlap is near 10% of 10%, not 100%.
    let bothHeld = 0
    let firstHeld = 0
    const n = 5000
    for (let i = 0; i < n; i++) {
      const a = isHoldout(`gpcprof_${i}`, flow({ key: "flow-a" }))
      const b = isHoldout(`gpcprof_${i}`, flow({ key: "flow-b" }))
      if (a) firstHeld += 1
      if (a && b) bothHeld += 1
    }
    // P(b|a) should be ~10%, definitely far below 50%.
    expect(bothHeld / Math.max(firstHeld, 1)).toBeLessThan(0.25)
  })
})
