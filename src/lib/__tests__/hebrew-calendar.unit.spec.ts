import {
  getSendBlackoutWindows,
  isInSendBlackout,
  nextAllowedSendTime,
  getUpcomingHoliday,
  resolveCalendarAnchor,
  isYomTovOrShabbat,
  candleLightingOn,
} from "../communications/hebrew-calendar"

// All instants are constructed in UTC. Atlanta is ET: EDT = UTC-4 (summer),
// EST = UTC-5 (winter).

describe("hebrew-calendar send blackout", () => {
  it("allows an ordinary Tuesday noon", () => {
    // Tue 2026-07-14 12:00 EDT = 16:00Z
    const check = isInSendBlackout(new Date("2026-07-14T16:00:00Z"))
    expect(check.blocked).toBe(false)
  })

  it("blocks Shabbat afternoon", () => {
    // Sat 2026-07-11 12:00 EDT = 16:00Z
    const check = isInSendBlackout(new Date("2026-07-11T16:00:00Z"))
    expect(check.blocked).toBe(true)
    expect(check.until).toBeInstanceOf(Date)
  })

  it("blocks inside the pre-candle buffer on Friday evening", () => {
    // Fri 2026-07-10: Atlanta sunset ≈ 20:50 EDT, candles ≈ 20:32 EDT.
    // 2h buffer opens the window ≈ 18:32 EDT. Test 19:30 EDT = 23:30Z.
    const check = isInSendBlackout(new Date("2026-07-10T23:30:00Z"))
    expect(check.blocked).toBe(true)
  })

  it("allows late Saturday night after havdalah", () => {
    // Sat 2026-07-11: havdalah ≈ 21:40 EDT. Test 23:50 EDT = 03:50Z Sun.
    const check = isInSendBlackout(new Date("2026-07-12T03:50:00Z"))
    expect(check.blocked).toBe(false)
  })

  it("blocks the full chained Pesach-into-Shabbat span (2027: Thu+Fri+Shabbat)", () => {
    // Pesach 5787: first seder Wed evening 2027-04-21; Pesach I Thu 04-22,
    // Pesach II Fri 04-23, straight into Shabbat 04-24 — one continuous
    // blackout Wed evening → Sat night.
    const thuNoon = new Date("2027-04-22T16:00:00Z")
    const friNoon = new Date("2027-04-23T16:00:00Z")
    const satNoon = new Date("2027-04-24T16:00:00Z")
    const sunNoon = new Date("2027-04-25T16:00:00Z")
    expect(isInSendBlackout(thuNoon).blocked).toBe(true)
    expect(isInSendBlackout(friNoon).blocked).toBe(true)
    expect(isInSendBlackout(satNoon).blocked).toBe(true)
    // Chol hamoed is NOT blacked out.
    expect(isInSendBlackout(sunNoon).blocked).toBe(false)
  })

  it("nextAllowedSendTime hops the whole chained span", () => {
    const thuNoon = new Date("2027-04-22T16:00:00Z")
    const resume = nextAllowedSendTime(thuNoon)
    // Must resume after Shabbat 04-24 havdalah (≈ 21:05 EDT = 01:05Z Sun).
    expect(resume.getTime()).toBeGreaterThan(
      new Date("2027-04-25T00:30:00Z").getTime()
    )
    // …and on that Sunday, not later.
    expect(resume.getTime()).toBeLessThan(
      new Date("2027-04-25T16:00:00Z").getTime()
    )
    expect(isInSendBlackout(resume).blocked).toBe(false)
  })

  it("blocks winter Friday night (EST/DST edge)", () => {
    // Fri 2026-12-11: Atlanta sunset ≈ 17:28 EST, candles ≈ 17:10 EST.
    // Test 18:00 EST = 23:00Z.
    const check = isInSendBlackout(new Date("2026-12-11T23:00:00Z"))
    expect(check.blocked).toBe(true)
  })

  it("returns merged windows covering Shabbat within a range", () => {
    const windows = getSendBlackoutWindows(
      new Date("2026-07-09T00:00:00Z"),
      new Date("2026-07-13T00:00:00Z")
    )
    expect(windows.length).toBeGreaterThanOrEqual(1)
    const shabbat = windows[0]
    expect(shabbat.end.getTime()).toBeGreaterThan(shabbat.start.getTime())
    // Spans Fri evening → Sat night: at least 24h with the buffer.
    const hours =
      (shabbat.end.getTime() - shabbat.start.getTime()) / 3_600_000
    expect(hours).toBeGreaterThan(24)
    expect(hours).toBeLessThan(32)
  })
})

describe("hebrew-calendar holiday anchors", () => {
  it("resolves Pesach 2027 with seder-night erev", () => {
    const pesach = getUpcomingHoliday("pesach", new Date("2026-08-01T00:00:00Z"))
    expect(pesach.date.getFullYear()).toBe(2027)
    expect(pesach.date.getMonth()).toBe(3) // April
    expect(pesach.date.getDate()).toBe(22)
    expect(pesach.erev.getDate()).toBe(21) // first seder night
  })

  it("resolves '6 weeks before seder' to 2027-03-10", () => {
    const { fireAt } = resolveCalendarAnchor(
      { anchor: "pesach", offsetDays: -42, fromErev: true },
      new Date("2026-08-01T00:00:00Z")
    )
    expect(fireAt.getFullYear()).toBe(2027)
    expect(fireAt.getMonth()).toBe(2) // March
    expect(fireAt.getDate()).toBe(10)
  })

  it("rolls to the following year when the offset already passed", () => {
    // 2 weeks before Pesach 2026 (seder 04-01) is in the past from July —
    // must resolve against Pesach 2027 instead.
    const { fireAt, holiday } = resolveCalendarAnchor(
      { anchor: "pesach", offsetDays: -14, fromErev: true },
      new Date("2026-07-07T00:00:00Z")
    )
    expect(holiday.date.getFullYear()).toBe(2027)
    expect(fireAt.getFullYear()).toBe(2027)
    expect(fireAt.getMonth()).toBe(3) // April 7
  })

  it("flags Yom Kippur 2026 as yom tov", () => {
    expect(isYomTovOrShabbat(new Date("2026-09-21T16:00:00Z"))).toBe(true)
  })

  it("does not flag an ordinary Wednesday", () => {
    expect(isYomTovOrShabbat(new Date("2026-07-15T16:00:00Z"))).toBe(false)
  })

  it("computes a candle-lighting instant for a Friday", () => {
    const cl = candleLightingOn(new Date("2026-07-10T12:00:00Z"))
    expect(cl).toBeInstanceOf(Date)
    // Atlanta July candles ≈ 20:32 EDT = 00:32Z next day
    const hourUtc = cl!.getUTCHours()
    expect([0, 1]).toContain(hourUtc)
  })
})
