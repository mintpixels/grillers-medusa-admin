import { attributionSummary } from "./attribution"
import { deliverabilityReport, flowIncrementalReport } from "./incremental"

type KnexLike = any

function countValue(row: Record<string, any> | undefined) {
  return Number(row?.count || 0)
}

export async function communicationReporting(db: KnexLike, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000)

  const [
    eventsByName,
    messagesByStatus,
    messagesByStream,
    messagesByPurpose,
    cartCounts,
    deliveryCounts,
    importRuns,
    attribution,
    incremental,
    deliverability,
  ] = await Promise.all([
    db("gp_communication_event")
      .whereNull("deleted_at")
      .where("occurred_at", ">=", since)
      .select("event_name")
      .count({ count: "*" })
      .groupBy("event_name")
      .orderBy("count", "desc"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .select("status")
      .count({ count: "*" })
      .groupBy("status"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .select("message_stream")
      .count({ count: "*" })
      .groupBy("message_stream"),
    db("gp_message_log")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .select("message_purpose")
      .count({ count: "*" })
      .groupBy("message_purpose"),
    db("gp_cart_lifecycle")
      .whereNull("deleted_at")
      .select("status")
      .count({ count: "*" })
      .groupBy("status"),
    db("gp_event_delivery")
      .whereNull("deleted_at")
      .where("created_at", ">=", since)
      .select("target", "status")
      .count({ count: "*" })
      .groupBy("target", "status"),
    db("gp_import_run")
      .whereNull("deleted_at")
      .select("id", "source", "status", "started_at", "completed_at", "stats")
      .orderBy("created_at", "desc")
      .limit(10),
    attributionSummary(db, days),
    flowIncrementalReport(db, Math.max(days, 90)).catch(() => null),
    deliverabilityReport(db, days).catch(() => null),
  ])

  const sent = messagesByStatus.find((row: any) => row.status === "sent")
  const delivered = messagesByStatus.find((row: any) => row.status === "delivered")
  const bounced = messagesByStatus.find((row: any) => row.status === "bounced")
  const complained = messagesByStatus.find((row: any) => row.status === "complained")
  const recovered = cartCounts.find((row: any) => row.status === "recovered")
  const expired = cartCounts.find((row: any) => row.status === "expired")

  return {
    days,
    metrics: {
      sent_or_queued: messagesByStatus.reduce(
        (sum: number, row: Record<string, any>) => sum + countValue(row),
        0
      ),
      sent: countValue(sent),
      delivered: countValue(delivered),
      bounced: countValue(bounced),
      complained: countValue(complained),
      abandoned_carts: countValue(expired),
      recovered_carts: countValue(recovered),
      attributed_orders: attribution.total.orders,
      attributed_revenue: attribution.total.revenue,
    },
    events_by_name: eventsByName,
    messages_by_status: messagesByStatus,
    messages_by_stream: messagesByStream,
    messages_by_purpose: messagesByPurpose,
    carts_by_status: cartCounts,
    delivery_by_target: deliveryCounts,
    attribution,
    incremental,
    deliverability,
    import_runs: importRuns,
  }
}
