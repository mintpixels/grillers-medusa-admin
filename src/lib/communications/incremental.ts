type KnexLike = any

function num(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function rate(numerator: number, denominator: number) {
  if (!denominator) return 0
  return Math.round((numerator / denominator) * 10000) / 10000
}

/**
 * Treated-vs-holdout incremental read per flow.
 *
 * Every enrollment is deterministically bucketed at enroll time
 * (metadata.holdout = true|false, sha1(profileId:flowKey) % 100).
 * Holdout enrollments advance through steps with identical timing but
 * never send, so "order_completed within N days of enrollment" is an
 * apples-to-apples conversion comparison between the two groups.
 */
export async function flowIncrementalReport(
  db: KnexLike,
  days = 90,
  conversionWindowDays = 14
) {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)
  const windowDays = Math.max(1, Math.min(60, conversionWindowDays))

  // Query 1: enrollment counts per flow × holdout bucket.
  const enrollmentRows = await db("gp_flow_enrollment")
    .whereNull("deleted_at")
    .where("enrolled_at", ">=", since)
    .select(
      "flow_key",
      db.raw(`coalesce((metadata->>'holdout')::boolean, false) as holdout`)
    )
    .countDistinct({ enrolled: "id" })
    .groupBy("flow_key", db.raw(`coalesce((metadata->>'holdout')::boolean, false)`))

  // Query 2: conversions. The inner DISTINCT dedupes (flow, order) pairs so
  // a profile with two enrollments in the same flow can't double-count one
  // order, and a plain SUM over the deduped rows keeps same-valued orders.
  const conversionResult = await db.raw(
    `
    select flow_key, holdout,
           count(distinct profile_id) as converters,
           count(*) as orders,
           coalesce(sum(revenue), 0) as revenue
    from (
      select distinct e.flow_key,
             coalesce((e.metadata->>'holdout')::boolean, false) as holdout,
             e.profile_id,
             ev.order_id,
             coalesce(
               nullif(ev.properties->>'total', '')::numeric,
               nullif(ev.properties->>'revenue', '')::numeric,
               nullif(ev.properties->>'amount_total', '')::numeric,
               0
             ) as revenue
      from gp_flow_enrollment e
      join gp_communication_event ev
        on ev.profile_id = e.profile_id
       and ev.event_name = 'order_completed'
       and ev.deleted_at is null
       and ev.order_id is not null
       and ev.occurred_at >= e.enrolled_at
       and ev.occurred_at <= e.enrolled_at + (?::int * interval '1 day')
      where e.deleted_at is null
        and e.enrolled_at >= ?
    ) deduped
    group by flow_key, holdout
    `,
    [windowDays, since]
  )
  const conversionRows: Record<string, any>[] = conversionResult?.rows || []

  return shapeIncrementalFlows(enrollmentRows, conversionRows, days, windowDays)
}

/** Pure shaping/lift math — exported for unit tests. */
export function shapeIncrementalFlows(
  enrollmentRows: Record<string, any>[],
  conversionRows: Record<string, any>[],
  days: number,
  windowDays: number
) {
  const byFlow = new Map<string, any>()
  const bucketFor = (key: string) => {
    const existing = byFlow.get(key)
    if (existing) return existing
    const fresh = {
      flow_key: key,
      treated: { enrolled: 0, converters: 0, orders: 0, revenue: 0 },
      holdout: { enrolled: 0, converters: 0, orders: 0, revenue: 0 },
    }
    byFlow.set(key, fresh)
    return fresh
  }
  const sideOf = (holdout: unknown) =>
    holdout === true || holdout === "true" || holdout === "t" ? "holdout" : "treated"

  for (const row of enrollmentRows as Record<string, any>[]) {
    const bucket = bucketFor(String(row.flow_key || "unknown"))
    bucket[sideOf(row.holdout)].enrolled = num(row.enrolled)
  }
  for (const row of conversionRows) {
    const bucket = bucketFor(String(row.flow_key || "unknown"))
    const side = bucket[sideOf(row.holdout)]
    side.converters = num(row.converters)
    side.orders = num(row.orders)
    side.revenue = num(row.revenue)
  }

  const flows = Array.from(byFlow.values()).map((f) => {
    const treatedRate = rate(f.treated.converters, f.treated.enrolled)
    const holdoutRate = rate(f.holdout.converters, f.holdout.enrolled)
    const treatedRpe = f.treated.enrolled ? f.treated.revenue / f.treated.enrolled : 0
    const holdoutRpe = f.holdout.enrolled ? f.holdout.revenue / f.holdout.enrolled : 0
    const incrementalRpe = treatedRpe - holdoutRpe
    return {
      ...f,
      treated_conversion_rate: treatedRate,
      holdout_conversion_rate: holdoutRate,
      conversion_lift: Math.round((treatedRate - holdoutRate) * 10000) / 10000,
      treated_revenue_per_enrolled: Math.round(treatedRpe * 100) / 100,
      holdout_revenue_per_enrolled: Math.round(holdoutRpe * 100) / 100,
      incremental_revenue_per_enrolled: Math.round(incrementalRpe * 100) / 100,
      estimated_incremental_revenue:
        Math.round(incrementalRpe * f.treated.enrolled * 100) / 100,
      // With small holdout groups the read is noisy — surface the caveat
      // instead of letting an operator over-trust a 5-person holdout.
      low_confidence: f.holdout.enrolled < 50,
    }
  })

  flows.sort(
    (a, b) => b.estimated_incremental_revenue - a.estimated_incremental_revenue
  )

  return {
    days,
    conversion_window_days: windowDays,
    flows,
    total_estimated_incremental_revenue:
      Math.round(
        flows.reduce((sum, f) => sum + f.estimated_incremental_revenue, 0) * 100
      ) / 100,
  }
}

/**
 * Deliverability panel: per-stream day series + rollups, plus active
 * suppression counts. Bounce/complaint rates here are the early-warning
 * signal for the temporary sending domain during warm-up.
 */
export async function deliverabilityReport(db: KnexLike, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)

  const [statusRows, dayRows, suppressionRows, smsRows] = await Promise.all([
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .where("channel", "email")
      .select("message_stream", "status")
      .count({ count: "*" })
      .groupBy("message_stream", "status"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .where("channel", "email")
      .select(
        db.raw(`date_trunc('day', created_at) as day`),
        "message_stream",
        "status"
      )
      .count({ count: "*" })
      .groupBy(db.raw(`date_trunc('day', created_at)`), "message_stream", "status")
      .orderBy("day", "asc"),
    db("gp_suppression_preference")
      .whereNull("deleted_at")
      .whereNull("resubscribed_at")
      .select("reason")
      .count({ count: "*" })
      .groupBy("reason"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .where("channel", "sms")
      .select("status")
      .count({ count: "*" })
      .groupBy("status"),
  ])

  return shapeDeliverability(statusRows, dayRows, suppressionRows, smsRows, days)
}

/** Pure shaping/health math — exported for unit tests. */
export function shapeDeliverability(
  statusRows: Record<string, any>[],
  dayRows: Record<string, any>[],
  suppressionRows: Record<string, any>[],
  smsRows: Record<string, any>[],
  days: number
) {
  const streams: Record<string, any> = {}
  for (const row of statusRows as Record<string, any>[]) {
    const stream = String(row.message_stream || "unknown")
    const bucket = (streams[stream] = streams[stream] || {
      sent: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      failed: 0,
      total: 0,
    })
    const count = num(row.count)
    bucket.total += count
    const status = String(row.status || "")
    if (status === "sent" || status === "queued") bucket.sent += count
    else if (status === "delivered") bucket.delivered += count
    else if (status === "bounced") bucket.bounced += count
    else if (status === "complained") bucket.complained += count
    else if (status === "failed") bucket.failed += count
  }
  for (const stream of Object.keys(streams)) {
    const s = streams[stream]
    const attempted = s.total - s.failed
    s.bounce_rate = rate(s.bounced, attempted)
    s.complaint_rate = rate(s.complained, attempted)
    s.delivery_rate = rate(s.delivered, attempted)
    // Postmark suspends around 10% bounce / 0.1% spam; alert well before.
    s.health =
      s.bounce_rate > 0.05 || s.complaint_rate > 0.001
        ? "at_risk"
        : s.bounce_rate > 0.02
          ? "watch"
          : "healthy"
  }

  const daySeries = (dayRows as Record<string, any>[]).map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
    stream: String(row.message_stream || "unknown"),
    status: String(row.status || ""),
    count: num(row.count),
  }))

  const sms: Record<string, number> = {}
  for (const row of smsRows as Record<string, any>[]) {
    sms[String(row.status || "unknown")] = num(row.count)
  }

  return {
    days,
    streams,
    day_series: daySeries,
    suppressions: (suppressionRows as Record<string, any>[]).map((row) => ({
      reason: String(row.reason || "unknown"),
      count: num(row.count),
    })),
    sms_by_status: sms,
  }
}
