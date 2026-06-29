import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { timingSafeEqual } from "node:crypto"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

type MetadataBody = {
  metadata?: Record<string, unknown>
}

const ALERT_PATH = "src/api/api/qb-sync/orders/[id]/metadata/route.ts"

const header = (req: MedusaRequest, name: string): string => {
  const headers = req.headers as any
  return headers[name.toLowerCase()] || headers.get?.(name) || ""
}

const metadataObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {}
    } catch {
      return {}
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

const secureCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

const authorized = (req: MedusaRequest): boolean => {
  const token = process.env.QB_SYNC_ORDER_IMPORT_TOKEN || ""
  if (!token) return false

  const provided =
    header(req, "x-qb-sync-token") ||
    header(req, "authorization").replace(/^Bearer\s+/i, "")

  return provided ? secureCompare(provided, token) : false
}

function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:order|cart|pi|seti|cus|pm)_[A-Za-z0-9_]+/g, "[redacted-id]")
    .slice(0, 500)
}

function routeLogger(req: MedusaRequest) {
  try {
    return req.scope.resolve("logger")
  } catch {
    return undefined
  }
}

async function emitQbMetadataRouteFailureAlert(input: {
  req: MedusaRequest
  orderId?: string | null
  reason: "configuration" | "metadata_persist"
  error?: unknown
}) {
  await emitOpsAlert({
    alertKind: "qbd_order_metadata_update_failed",
    severity: "page",
    title:
      input.reason === "configuration"
        ? "QuickBooks metadata callback is not configured"
        : "QuickBooks metadata callback failed",
    path: ALERT_PATH,
    source: "medusa-server",
    fingerprint: `qbd_order_metadata_update:${input.reason}`,
    logger: routeLogger(input.req) as any,
    meta: {
      reason: input.reason,
      has_order_id: Boolean(input.orderId),
      order_id: input.orderId || null,
      error_message: input.error ? redactedErrorMessage(input.error) : null,
    },
  })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!process.env.QB_SYNC_ORDER_IMPORT_TOKEN) {
    await emitQbMetadataRouteFailureAlert({
      req,
      orderId: String(req.params?.id || ""),
      reason: "configuration",
      error: new Error("QB_SYNC_ORDER_IMPORT_TOKEN is not configured"),
    })
    res.status(503).json({ error: "QuickBooks metadata callback is not configured" })
    return
  }

  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  const orderId = req.params.id
  const body = (req.body ?? {}) as MetadataBody
  const incomingMetadata = metadataObject(body.metadata)

  if (!orderId || Object.keys(incomingMetadata).length === 0) {
    res.status(422).json({ error: "Missing order id or metadata" })
    return
  }

  try {
    const orderModule = req.scope.resolve(Modules.ORDER)
    const order = await orderModule.retrieveOrder(orderId, {
      select: ["id", "metadata"],
    })

    const metadata = {
      ...metadataObject(order?.metadata),
      ...incomingMetadata,
    }

    await orderModule.updateOrders(orderId, { metadata })
  } catch (error) {
    await emitQbMetadataRouteFailureAlert({
      req,
      orderId,
      reason: "metadata_persist",
      error,
    })
    res.status(500).json({ error: "QuickBooks metadata update failed" })
    return
  }

  res.status(200).json({ ok: true, order_id: orderId })
}
