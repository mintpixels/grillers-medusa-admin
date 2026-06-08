import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

const DEFAULT_PER_PAGE = "25"
const ALLOWED_QUERY_KEYS = [
  "status",
  "search",
  "page",
  "per_page",
  "sort",
  "direction",
] as const

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

function forwardedQuery(req: MedusaRequest) {
  const params = new URLSearchParams()

  for (const key of ALLOWED_QUERY_KEYS) {
    const raw = req.query?.[key]
    if (Array.isArray(raw)) {
      for (const value of raw) {
        if (value) {
          params.append(key, String(value))
        }
      }
      continue
    }

    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      params.set(key, String(raw))
    }
  }

  if (!params.has("per_page")) {
    params.set("per_page", DEFAULT_PER_PAGE)
  }

  return params
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const baseUrl = syncBaseUrl()
  const token = syncToken()

  if (!baseUrl || !token) {
    res.status(503).json({
      error: "QuickBooks sync status is not configured.",
    })
    return
  }

  const url = `${baseUrl}/api/dashboard/sync-queue?${forwardedQuery(req).toString()}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-QB-Sync-Token": token,
      },
      signal: controller.signal,
    })

    const body = await response.text()
    let payload: unknown = null
    try {
      payload = body ? JSON.parse(body) : {}
    } catch {
      payload = {
        error: "QuickBooks sync status returned a non-JSON response.",
      }
    }

    res.status(response.ok ? 200 : response.status).json(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    res.status(502).json({
      error: "QuickBooks sync status could not be reached.",
      message,
    })
  } finally {
    clearTimeout(timeout)
  }
}
