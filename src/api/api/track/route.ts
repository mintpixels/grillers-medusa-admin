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

const DEFAULT_ALLOWED_ORIGINS = [
  "https://grillers-medusa-frontend.vercel.app",
  "https://grillerspride.com",
  "https://www.grillerspride.com",
]

function splitOrigins(value?: string) {
  return (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function normalizeOrigin(value: string) {
  if (value === "*") return value
  try {
    return new URL(value).origin
  } catch {
    return value.replace(/\/+$/, "")
  }
}

function allowedOrigins() {
  return [
    ...DEFAULT_ALLOWED_ORIGINS,
    ...splitOrigins(process.env.STORE_CORS),
    ...splitOrigins(process.env.COMMUNICATIONS_CORS),
    ...splitOrigins(process.env.STOREFRONT_URL),
    ...splitOrigins(process.env.NEXT_PUBLIC_BASE_URL),
  ].map(normalizeOrigin)
}

function originMatches(pattern: string, origin: string) {
  if (pattern === "*" || pattern === origin) return true
  if (!pattern.includes("*")) return false

  try {
    const patternUrl = new URL(pattern)
    const originUrl = new URL(origin)
    if (patternUrl.protocol !== originUrl.protocol) return false
    const suffix = patternUrl.hostname.replace(/^\*\./, ".")
    return originUrl.hostname.endsWith(suffix)
  } catch {
    return false
  }
}

function setCorsHeaders(req: MedusaRequest, res: MedusaResponse) {
  const headers = req.headers as any
  const rawOrigin = headers.origin || headers.get?.("origin")
  const origin = rawOrigin ? normalizeOrigin(String(rawOrigin)) : ""
  const match = origin
    ? allowedOrigins().find((candidate) => originMatches(candidate, origin))
    : ""

  if (match) {
    res.setHeader("Access-Control-Allow-Origin", match === "*" ? "*" : origin)
    res.setHeader("Vary", "Origin")
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, x-api-key"
  )
  res.setHeader("Access-Control-Max-Age", "86400")

  return Boolean(!origin || match)
}

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

function sampleEventKeys(body: unknown) {
  return body && typeof body === "object" && !Array.isArray(body)
    ? Object.keys(body as Record<string, any>).slice(0, 20)
    : []
}

export async function OPTIONS(req: MedusaRequest, res: MedusaResponse) {
  if (!setCorsHeaders(req, res)) {
    res.status(403).send("")
    return
  }

  res.status(204).send("")
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!setCorsHeaders(req, res)) {
    res.status(403).json({ ok: false, error: "origin_not_allowed" })
    return
  }

  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const event = normalizeEvent(body)
  const logger = communicationsApiLogger(req)
  if (!event.event_name) {
    await emitCommunicationsApiDroppedEventsAlert({
      operation: "track",
      path: "src/api/api/track/route.ts",
      eventCount: 1,
      acceptedCount: 0,
      droppedCount: 1,
      reason: "missing_event_name",
      sampleEventKeys: sampleEventKeys(body),
      logger,
    })
    res.status(400).json({ ok: false, error: "event is required" })
    return
  }

  try {
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const row = await recordCommunicationEvent(db, event)
    res.status(202).json({ ok: true, event_id: row.event_id })
  } catch (error) {
    await emitCommunicationsApiFailureAlert({
      operation: "track",
      path: "src/api/api/track/route.ts",
      eventName: event.event_name,
      hasEmail: Boolean(event.email),
      error,
      logger,
    })
    res.status(500).json({ ok: false, error: "event_record_failed" })
  }
}
