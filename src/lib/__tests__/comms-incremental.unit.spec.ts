import {
  shapeDeliverability,
  shapeIncrementalFlows,
} from "../communications/incremental"

describe("shapeIncrementalFlows", () => {
  it("computes lift and incremental revenue per flow", () => {
    const enrollments = [
      { flow_key: "welcome", holdout: false, enrolled: "900" },
      { flow_key: "welcome", holdout: true, enrolled: "100" },
    ]
    const conversions = [
      {
        flow_key: "welcome",
        holdout: false,
        converters: "90",
        orders: "95",
        revenue: "9000",
      },
      {
        flow_key: "welcome",
        holdout: true,
        converters: "5",
        orders: "5",
        revenue: "500",
      },
    ]
    const report = shapeIncrementalFlows(enrollments, conversions, 90, 14)
    expect(report.flows).toHaveLength(1)
    const flow = report.flows[0]
    expect(flow.treated_conversion_rate).toBe(0.1) // 90/900
    expect(flow.holdout_conversion_rate).toBe(0.05) // 5/100
    expect(flow.conversion_lift).toBe(0.05)
    expect(flow.treated_revenue_per_enrolled).toBe(10)
    expect(flow.holdout_revenue_per_enrolled).toBe(5)
    expect(flow.incremental_revenue_per_enrolled).toBe(5)
    expect(flow.estimated_incremental_revenue).toBe(4500) // 5 * 900
    expect(report.total_estimated_incremental_revenue).toBe(4500)
  })

  it("flags low confidence when the holdout group is small", () => {
    const report = shapeIncrementalFlows(
      [
        { flow_key: "pesach", holdout: false, enrolled: 40 },
        { flow_key: "pesach", holdout: true, enrolled: 4 },
      ],
      [],
      90,
      14
    )
    expect(report.flows[0].low_confidence).toBe(true)
  })

  it("treats postgres 't' string as holdout truthy", () => {
    const report = shapeIncrementalFlows(
      [
        { flow_key: "winback", holdout: "t", enrolled: 10 },
        { flow_key: "winback", holdout: "f", enrolled: 90 },
      ],
      [],
      90,
      14
    )
    expect(report.flows[0].holdout.enrolled).toBe(10)
    expect(report.flows[0].treated.enrolled).toBe(90)
  })

  it("handles a flow with conversions but zero recorded enrollments without dividing by zero", () => {
    const report = shapeIncrementalFlows(
      [],
      [
        {
          flow_key: "orphan",
          holdout: false,
          converters: 2,
          orders: 2,
          revenue: 200,
        },
      ],
      90,
      14
    )
    const flow = report.flows[0]
    expect(flow.treated_conversion_rate).toBe(0)
    expect(flow.treated_revenue_per_enrolled).toBe(0)
    expect(flow.estimated_incremental_revenue).toBe(0)
  })

  it("a flow with NO holdout group reports zero incremental and a no_holdout flag", () => {
    const report = shapeIncrementalFlows(
      [{ flow_key: "unmeasured", holdout: false, enrolled: 100 }],
      [
        {
          flow_key: "unmeasured",
          holdout: false,
          converters: 20,
          orders: 25,
          revenue: 5000,
        },
      ],
      90,
      14
    )
    const flow = report.flows[0]
    // Without a counterfactual the flow must NOT claim its full revenue
    // as incremental (that would float it to the top of the list).
    expect(flow.no_holdout).toBe(true)
    expect(flow.estimated_incremental_revenue).toBe(0)
    expect(flow.conversion_lift).toBe(0)
    expect(flow.treated_revenue_per_enrolled).toBe(50) // raw RPE still shown
    expect(report.total_estimated_incremental_revenue).toBe(0)
    expect(report.total_is_upper_bound).toBe(true)
  })

  it("sorts flows by estimated incremental revenue descending", () => {
    const report = shapeIncrementalFlows(
      [
        { flow_key: "small", holdout: false, enrolled: 100 },
        { flow_key: "small", holdout: true, enrolled: 100 },
        { flow_key: "big", holdout: false, enrolled: 100 },
        { flow_key: "big", holdout: true, enrolled: 100 },
      ],
      [
        { flow_key: "small", holdout: false, converters: 1, orders: 1, revenue: 100 },
        { flow_key: "big", holdout: false, converters: 10, orders: 10, revenue: 5000 },
      ],
      90,
      14
    )
    expect(report.flows.map((f: any) => f.flow_key)).toEqual(["big", "small"])
  })
})

describe("shapeDeliverability", () => {
  it("computes per-stream rates and health", () => {
    const statusRows = [
      { message_stream: "broadcast", status: "delivered", count: 940 },
      { message_stream: "broadcast", status: "bounced", count: 60 },
      { message_stream: "outbound", status: "delivered", count: 100 },
    ]
    const report = shapeDeliverability(statusRows, [], [], [], 30)
    const broadcast = report.streams.broadcast
    expect(broadcast.total).toBe(1000)
    expect(broadcast.bounce_rate).toBe(0.06)
    expect(broadcast.health).toBe("at_risk") // > 5% bounce
    expect(report.streams.outbound.health).toBe("healthy")
  })

  it("unresolved sent/queued messages don't dilute bounce rate during warm-up", () => {
    const report = shapeDeliverability(
      [
        // 900 still in flight, only 100 resolved: 6 bounces of 100
        // resolved = 6%, NOT 6/1000 = 0.6%.
        { message_stream: "broadcast", status: "sent", count: 900 },
        { message_stream: "broadcast", status: "delivered", count: 94 },
        { message_stream: "broadcast", status: "bounced", count: 6 },
      ],
      [],
      [],
      [],
      30
    )
    expect(report.streams.broadcast.bounce_rate).toBe(0.06)
    expect(report.streams.broadcast.health).toBe("at_risk")
  })

  it("unknown statuses land in other and don't dilute rates", () => {
    const report = shapeDeliverability(
      [
        { message_stream: "broadcast", status: "delivered", count: 94 },
        { message_stream: "broadcast", status: "bounced", count: 6 },
        { message_stream: "broadcast", status: "deferred", count: 400 },
      ],
      [],
      [],
      [],
      30
    )
    expect(report.streams.broadcast.other).toBe(400)
    expect(report.streams.broadcast.bounce_rate).toBe(0.06)
  })

  it("flags watch between 2% and 5% bounce", () => {
    const report = shapeDeliverability(
      [
        { message_stream: "lifecycle", status: "delivered", count: 970 },
        { message_stream: "lifecycle", status: "bounced", count: 30 },
      ],
      [],
      [],
      [],
      30
    )
    expect(report.streams.lifecycle.health).toBe("watch")
  })

  it("flags at_risk on complaint rate above 0.1% even with clean bounces", () => {
    const report = shapeDeliverability(
      [
        { message_stream: "broadcast", status: "delivered", count: 998 },
        { message_stream: "broadcast", status: "complained", count: 2 },
      ],
      [],
      [],
      [],
      30
    )
    expect(report.streams.broadcast.complaint_rate).toBe(0.002)
    expect(report.streams.broadcast.health).toBe("at_risk")
  })

  it("excludes failed sends from the attempted denominator", () => {
    const report = shapeDeliverability(
      [
        { message_stream: "broadcast", status: "delivered", count: 95 },
        { message_stream: "broadcast", status: "bounced", count: 5 },
        { message_stream: "broadcast", status: "failed", count: 900 },
      ],
      [],
      [],
      [],
      30
    )
    expect(report.streams.broadcast.bounce_rate).toBe(0.05) // 5/100, not 5/1000
  })

  it("shapes day series, suppressions, and sms buckets", () => {
    const report = shapeDeliverability(
      [],
      [
        {
          day: new Date("2026-07-01T00:00:00Z"),
          message_stream: "broadcast",
          status: "delivered",
          count: "12",
        },
      ],
      [{ reason: "unsubscribe", count: "42" }],
      [{ status: "sent", count: 7 }],
      30
    )
    expect(report.day_series[0]).toEqual({
      day: "2026-07-01",
      stream: "broadcast",
      status: "delivered",
      count: 12,
    })
    expect(report.suppressions).toEqual([{ reason: "unsubscribe", count: 42 }])
    expect(report.sms_by_status).toEqual({ sent: 7 })
  })
})
