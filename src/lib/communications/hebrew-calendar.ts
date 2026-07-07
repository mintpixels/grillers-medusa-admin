// @hebcal/core 5.x ships a CJS entry (dist/index.cjs) but declares its
// types ESM-only, which fights this repo's CJS build (TS1479) AND the
// SWC jest transformer (no import-attribute support). So: values via
// require, and a minimal local interface for the three Event methods we
// touch. Every export of THIS module stays fully typed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const hebcal = require("@hebcal/core") as any
const { HebrewCalendar, Location, Zmanim, flags, HDate } = hebcal

type HebcalEvent = {
  getDesc(): string
  getFlags(): number
  getDate(): { greg(): Date }
}

/**
 * Hebrew-calendar intelligence for GP Comms.
 *
 * Two jobs:
 *
 *  1. THE BLACKOUT (platform rule, no operator override): no message of any
 *     kind sends during Shabbat or Yom Tov. Implemented as candle-lighting →
 *     havdalah windows for the business's home community (Atlanta —
 *     diaspora two-day Yom Tov), with a configurable pre-candle buffer so a
 *     campaign queued at 5:59pm Friday doesn't land at licht-bentshn.
 *     Chol hamoed is NOT blacked out.
 *
 *  2. HOLIDAY ANCHORS for scheduling: "6 weeks before seder", "KFP order
 *     deadline", "erev Rosh Hashana" — resolved to concrete instants so
 *     flows and campaigns can be authored against the calendar the business
 *     actually runs on.
 *
 * All computation is local (@hebcal/core) — no network, deterministic,
 * testable.
 */

// Atlanta: the business's home community. Blackouts are enforced on the
// business's clock — a national customer may receive nothing on GP's
// Shabbat even after havdalah in their timezone; that is the intended,
// conservative behavior for a shomer-shabbos brand.
const BUSINESS_LOCATION = Location.lookup("Atlanta")

/** Stop sending this many minutes BEFORE candle lighting. */
const PRE_CANDLE_BUFFER_MIN = Number(
  process.env.COMMS_BLACKOUT_PRE_CANDLE_MIN || 120
)

/** Havdalah = sunset + this many minutes (50 = common US practice). */
const HAVDALAH_MINS = Number(process.env.COMMS_HAVDALAH_MINS || 50)

export type BlackoutWindow = {
  start: Date
  end: Date
  reason: string
}

export type BlackoutCheck = {
  blocked: boolean
  reason?: string
  /** When sending becomes allowed again (only when blocked). */
  until?: Date
}

type TimedPoint = {
  at: Date
  kind: "candles" | "havdalah"
  desc: string
}

function collectTimedPoints(startUtc: Date, endUtc: Date): TimedPoint[] {
  const events: HebcalEvent[] = HebrewCalendar.calendar({
    start: new HDate(new Date(startUtc.getTime() - 3 * 86400_000)),
    end: new HDate(new Date(endUtc.getTime() + 3 * 86400_000)),
    location: BUSINESS_LOCATION,
    candlelighting: true,
    havdalahMins: HAVDALAH_MINS,
    sedrot: false,
    omer: false,
    noModern: false,
  })

  const points: TimedPoint[] = []
  for (const ev of events) {
    const anyEv = ev as any
    const time: Date | undefined = anyEv.eventTime
    if (!time) continue
    const desc = ev.getDesc()
    if (desc.startsWith("Candle lighting")) {
      points.push({ at: time, kind: "candles", desc })
    } else if (desc.startsWith("Havdalah")) {
      points.push({ at: time, kind: "havdalah", desc })
    }
  }
  points.sort((a, b) => a.at.getTime() - b.at.getTime())
  return points
}

/**
 * Blackout windows between two instants: each window opens at the first
 * candle-lighting (minus buffer) and closes at the first havdalah after it.
 * Consecutive candle-lightings without an intervening havdalah (Shabbat →
 * Yom Tov, or two-day chag) extend the same window — exactly how the
 * halachic day-spans chain in the diaspora.
 */
export function getSendBlackoutWindows(
  startUtc: Date,
  endUtc: Date
): BlackoutWindow[] {
  const points = collectTimedPoints(startUtc, endUtc)
  const windows: BlackoutWindow[] = []
  let open: { start: Date; descs: string[] } | null = null

  for (const p of points) {
    if (p.kind === "candles") {
      const buffered = new Date(
        p.at.getTime() - PRE_CANDLE_BUFFER_MIN * 60_000
      )
      if (!open) {
        open = { start: buffered, descs: [p.desc] }
      } else {
        open.descs.push(p.desc)
      }
    } else if (p.kind === "havdalah" && open) {
      windows.push({
        start: open.start,
        end: p.at,
        reason: open.descs.length > 1 ? "Shabbat/Yom Tov" : "Shabbat",
      })
      open = null
    }
  }

  // A window still open past our horizon: close it at the horizon so the
  // caller sees the block (rare — only when endUtc lands mid-Shabbat).
  if (open) {
    windows.push({ start: open.start, end: endUtc, reason: "Shabbat/Yom Tov" })
  }

  return windows.filter((w) => w.end > startUtc && w.start < endUtc)
}

/** Is this instant inside a send blackout? The runner's gate. */
export function isInSendBlackout(at: Date = new Date()): BlackoutCheck {
  const windows = getSendBlackoutWindows(
    new Date(at.getTime() - 4 * 86400_000),
    new Date(at.getTime() + 4 * 86400_000)
  )
  for (const w of windows) {
    if (at >= w.start && at < w.end) {
      return { blocked: true, reason: w.reason, until: w.end }
    }
  }
  return { blocked: false }
}

/**
 * First instant at/after `at` when sending is allowed, plus a small settle
 * buffer after havdalah so nothing fires the second Shabbat ends.
 */
export function nextAllowedSendTime(at: Date = new Date()): Date {
  const POST_HAVDALAH_BUFFER_MS = 10 * 60_000
  let cursor = new Date(at)
  // Chained chag+Shabbat spans can cover 3 days; loop until clear.
  for (let i = 0; i < 5; i++) {
    const check = isInSendBlackout(cursor)
    if (!check.blocked) return cursor
    cursor = new Date(check.until!.getTime() + POST_HAVDALAH_BUFFER_MS)
  }
  return cursor
}

// ─── Holiday anchors ─────────────────────────────────────────────────

export type HolidayAnchorName =
  | "pesach" // first seder night
  | "pesach_end" // end of the last day of Pesach
  | "rosh_hashana"
  | "yom_kippur"
  | "sukkot"
  | "chanukah"
  | "purim"
  | "shavuot"
  | "tu_bishvat"

const ANCHOR_HOLIDAY_DESC: Record<HolidayAnchorName, string> = {
  pesach: "Pesach I",
  pesach_end: "Pesach VIII",
  rosh_hashana: "Rosh Hashana",
  yom_kippur: "Yom Kippur",
  sukkot: "Sukkot I",
  chanukah: "Chanukah: 1 Candle",
  purim: "Purim",
  shavuot: "Shavuot I",
  tu_bishvat: "Tu BiShvat",
}

export type HolidayAnchor = {
  name: HolidayAnchorName
  /** Civil date of the holiday day itself (local midnight, business tz). */
  date: Date
  /** Erev — the day before (when the seder happens, for pesach). */
  erev: Date
  hebrewYear: number
}

/**
 * The next occurrence of a holiday anchor at/after `from`. For `pesach`,
 * `erev` is seder night's civil date — the anchor GP plans around.
 */
export function getUpcomingHoliday(
  name: HolidayAnchorName,
  from: Date = new Date()
): HolidayAnchor {
  const targetDesc = ANCHOR_HOLIDAY_DESC[name]
  const fromH = new HDate(from)

  for (let yearOffset = 0; yearOffset <= 2; yearOffset++) {
    const hyear = fromH.getFullYear() + yearOffset
    const events = HebrewCalendar.calendar({
      year: hyear,
      isHebrewYear: true,
      candlelighting: false,
      sedrot: false,
      omer: false,
    })
    for (const ev of events) {
      if (ev.getDesc() === targetDesc) {
        const civil = ev.getDate().greg()
        if (civil >= startOfDay(from)) {
          const erev = addDays(civil, -1)
          return { name, date: civil, erev, hebrewYear: hyear }
        }
      }
    }
  }
  throw new Error(`Could not resolve holiday anchor ${name}`)
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

/** DST-safe civil-day arithmetic (raw ms math drifts across spring-forward). */
function addDays(d: Date, days: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + days)
  return c
}

export type CalendarAnchorSpec = {
  anchor: HolidayAnchorName
  /** Days relative to the anchor (negative = before). -42 = 6 weeks out. */
  offsetDays: number
  /** Anchor to erev (seder night for pesach) instead of the day itself. */
  fromErev?: boolean
}

/**
 * "6 weeks before seder" → { anchor: "pesach", offsetDays: -42, fromErev: true }.
 * Returns the concrete civil date for the next occurrence.
 */
export function resolveCalendarAnchor(
  spec: CalendarAnchorSpec,
  from: Date = new Date()
): { fireAt: Date; holiday: HolidayAnchor } {
  // Search from `from` forward; if the offset lands in the past for the
  // nearest holiday, roll to the following year's occurrence.
  let searchFrom = new Date(from)
  for (let i = 0; i < 3; i++) {
    const holiday = getUpcomingHoliday(spec.anchor, searchFrom)
    const base = spec.fromErev ? holiday.erev : holiday.date
    const fireAt = addDays(base, spec.offsetDays)
    if (fireAt >= startOfDay(from)) {
      return { fireAt, holiday }
    }
    // Try the next year's occurrence.
    searchFrom = new Date(holiday.date.getTime() + 30 * 86400_000)
  }
  throw new Error(
    `Could not resolve calendar anchor ${spec.anchor}${spec.offsetDays}`
  )
}

/** Candle-lighting time for a given civil date (for copy like "order by"). */
export function candleLightingOn(date: Date): Date | null {
  const zmanim = new Zmanim(BUSINESS_LOCATION, new HDate(date), false)
  const sunset = zmanim.sunset()
  if (!sunset || Number.isNaN(sunset.getTime())) return null
  return new Date(sunset.getTime() - 18 * 60_000)
}

/** True when the given civil date is Yom Tov or Shabbat (whole-day check). */
export function isYomTovOrShabbat(date: Date): boolean {
  const hd = new HDate(date)
  if (hd.getDay() === 6) return true
  const holidays = HebrewCalendar.getHolidaysOnDate(hd, false) || []
  return holidays.some((ev) => (ev.getFlags() & flags.CHAG) !== 0)
}
