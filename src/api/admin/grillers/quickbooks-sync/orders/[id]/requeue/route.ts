import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { emitQbSyncDashboardFailureAlert } from "../../../../../../../lib/qb-sync-dashboard-alerts"

function syncBaseUrl() {
  const raw =
    process.env.QB_SYNC_STATUS_URL ||
    process.env.QB_SYNC_ORDER_IMPORT_URL ||
    ""
  const trimmed = raw.trim().replace(/\/+$/, "")

  if (!trimmed) {
    return ""
  }

  return trimmed.replace(/\/api\/medusa\/orders$/i, "")
}

function syncToken() {
  return (
    process.env.QB_SYNC_STATUS_TOKEN ||
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN ||
    ""
  ).trim()
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = syncBaseUrl()
  const token = syncToken()
  const id = String(req.params?.id || "").trim()
  const logger = req.scope.resolve("logger") as
    | { warn?: (message: string) => void; error?: (message: string) => void }
    | undefined

  if (!baseUrl || !token) {
    res.status(503).json({
      error: "QuickBooks sync status is not configured.",
    })
    return
  }

  if (!id) {
    res.status(400).json({
      error: "QuickBooks sync order id is required.",
    })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch(
      `${baseUrl}/api/dashboard/sync-queue/${encodeURIComponent(id)}/requeue`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-QB-Sync-Token": token,
        },
        body: JSON.stringify(req.body || {}),
        signal: controller.signal,
      }
    )

    const body = await response.text()
    let payload: unknown = null
    try {
      payload = body ? JSON.parse(body) : {}
    } catch {
      payload = {
        error: "QuickBooks sync status returned a non-JSON response.",
      }
    }

    if (!response.ok) {
      await emitQbSyncDashboardFailureAlert({
        req,
        operation: "requeue",
        reason: "upstream_error",
        baseUrl,
        status: response.status,
        syncQueueId: id,
        error: payload,
        logger,
      })
    }

    res.status(response.ok ? 200 : response.status).json(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await emitQbSyncDashboardFailureAlert({
      req,
      operation: "requeue",
      reason: "unreachable",
      baseUrl,
      syncQueueId: id,
      error: err,
      logger,
    })
    res.status(502).json({
      error: "QuickBooks sync status could not be reached.",
      message,
    })
  } finally {
    clearTimeout(timeout)
  }
}
