import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { communicationQueueHealth } from "../../../../../lib/communications/queue"
import { resolvePostmarkMonthlyLimit } from "../../../../../lib/communications/postmark-usage"
import { respondAdminCommunicationsRouteFailure } from "../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const postmarkMonthlyLimit = resolvePostmarkMonthlyLimit()
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)
    const [queue, delivery, failures, monthlyMessages, monthlyByPurpose] =
      await Promise.all([
        communicationQueueHealth(),
        db("gp_event_delivery")
          .whereNull("deleted_at")
          .select("target", "status")
          .count({ count: "*" })
          .groupBy("target", "status"),
        db("gp_message_log")
          .whereNull("deleted_at")
          .whereIn("status", ["failed", "bounced", "complained"])
          .select("id", "email", "subject", "status", "error_message", "created_at")
          .orderBy("created_at", "desc")
          .limit(25),
        db("gp_message_log")
          .whereNull("deleted_at")
          .where("created_at", ">=", monthStart)
          .count({ count: "*" })
          .first(),
        db("gp_message_log")
          .whereNull("deleted_at")
          .where("created_at", ">=", monthStart)
          .select("message_purpose")
          .count({ count: "*" })
          .groupBy("message_purpose"),
      ])

    const sentThisMonth = Number(monthlyMessages?.count || 0)
    const usageRatio =
      postmarkMonthlyLimit.configured && postmarkMonthlyLimit.limit
        ? sentThisMonth / postmarkMonthlyLimit.limit
        : null

    res.status(200).json({
      queue,
      delivery,
      failures,
      postmark_usage: {
        month_start: monthStart.toISOString(),
        sent_or_queued_this_month: sentThisMonth,
        configured_monthly_limit: postmarkMonthlyLimit.limit,
        monthly_limit_configured: postmarkMonthlyLimit.configured,
        configuration_warning: postmarkMonthlyLimit.configuration_warning,
        configuration_error: postmarkMonthlyLimit.configuration_error,
        usage_ratio: usageRatio,
        warning:
          postmarkMonthlyLimit.configured &&
          usageRatio !== null &&
          usageRatio >= 0.8,
        by_purpose: monthlyByPurpose,
      },
    })
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "health",
      error,
      errorCode: "communications_health_failed",
      meta: {
        postmark_monthly_limit: postmarkMonthlyLimit.limit,
        postmark_monthly_limit_configured: postmarkMonthlyLimit.configured,
      },
    })
  }
}
