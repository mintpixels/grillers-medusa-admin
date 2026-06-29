import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  verifyServiceApiKey,
} from "../../../lib/communications/core"
import {
  communicationsApiLogger,
  emitCommunicationsApiDroppedEventsAlert,
  emitCommunicationsApiFailureAlert,
} from "../_shared/alerts"

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

function normalizeEvent(input: unknown) {
  const body =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, any>)
      : {}
  const ctx = body.eventn_ctx || body.context || {}
  const occurredAt =
    body.occurred_at ||
    body.timestamp ||
    body.event_timestamp_ms ||
    ctx.event_timestamp_ms
  return {
    event_name: body.event || body.event_name || body.event_type,
    event_id: body.event_id || ctx.event_id,
    source: body.source || ctx.source || "storefront",
    medusa_customer_id: body.customer_id || ctx.customer_id || ctx.user_id || ctx.user?.id,
    anonymous_id: body.anonymous_id || ctx.anonymous_id,
    session_id: body.session_id || ctx.session_id,
    cart_id: body.cart_id || ctx.cart_id,
    order_id: body.order_id || ctx.order_id,
    email: body.email || ctx.email || ctx.user?.email,
    customer_type: body.customer_type || ctx.customer_type,
    route_market: body.route_market || ctx.route_market,
    campaign_id: body.campaign_id || ctx.campaign_id,
    flow_id: body.flow_id || ctx.flow_id,
    template_key: body.template_key || ctx.template_key,
    occurred_at: occurredAt
      ? /^\d+$/.test(String(occurredAt))
        ? new Date(Number(occurredAt))
        : new Date(String(occurredAt))
      : undefined,
    properties: { ...body.properties, ...ctx },
    context: body.context || ctx,
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const events = Array.isArray(body.events) ? body.events : []
  if (!events.length || events.length > 50) {
    res.status(400).json({ ok: false, error: "events must contain 1-50 items" })
    return
  }

  const logger = communicationsApiLogger(req)
  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const rows: Array<Record<string, any>> = []
    let droppedCount = 0
    let sampleEventKeys: string[] = []

    for (const raw of events) {
      const event = normalizeEvent(raw)
      if (!event.event_name) {
        droppedCount += 1
        if (sampleEventKeys.length === 0 && raw && typeof raw === "object") {
          sampleEventKeys = Object.keys(raw).slice(0, 20)
        }
        continue
      }
      rows.push(await recordCommunicationEvent(db, event))
    }
    if (droppedCount > 0) {
      await emitCommunicationsApiDroppedEventsAlert({
        operation: "batch",
        path: "src/api/api/batch/route.ts",
        eventCount: events.length,
        acceptedCount: rows.length,
        droppedCount,
        reason: "missing_event_name",
        sampleEventKeys,
        logger,
      })
    }
    res.status(202).json({ ok: true, accepted: rows.length })
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "batch",
      path: "src/api/api/batch/route.ts",
      eventCount: events.length,
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "batch_record_failed" })
  }
}
