import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  verifyServiceApiKey,
} from "../../../lib/communications/core"

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

function occurredAt(body: Record<string, any>, ctx: Record<string, any>) {
  const value =
    body.occurred_at ||
    body.timestamp ||
    body.event_timestamp_ms ||
    ctx.event_timestamp_ms

  if (!value) return undefined
  if (typeof value === "number") return new Date(value)
  if (/^\d+$/.test(String(value))) return new Date(Number(value))
  return new Date(String(value))
}

function normalizeEvent(body: Record<string, any>) {
  const ctx = body.eventn_ctx || body.context || {}
  return {
    event_name: body.event || body.event_name || body.event_type,
    event_id: body.event_id || ctx.event_id,
    source: body.source || ctx.source || "storefront",
    profile_id: body.profile_id || ctx.profile_id,
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
    occurred_at: occurredAt(body, ctx),
    properties: {
      ...body.properties,
      ...ctx,
    },
    context: body.context || ctx,
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const event = normalizeEvent(body)
  if (!event.event_name) {
    res.status(400).json({ ok: false, error: "event is required" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const row = await recordCommunicationEvent(db, event)
  res.status(202).json({ ok: true, event_id: row.event_id })
}
