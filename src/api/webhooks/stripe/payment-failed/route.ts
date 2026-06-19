import { createHmac, timingSafeEqual } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  FINALIZATION_CHARGED_READY_TO_SHIP,
  metadataObject,
} from "../../../../lib/catch-weight-finalization"
import { emitChargeFailedPostShipAlert } from "../../../../lib/final-charge-ops-alerts"

// Stripe signs webhooks as: t=<unix>,v1=<hex hmac-sha256(`${t}.${rawBody}`, secret)>
// Tolerance window (seconds) to reject very old/replayed timestamps.
const SIGNATURE_TOLERANCE_SECONDS = 300

function rawBodyString(req: MedusaRequest): string {
  const raw = (req as any).rawBody
  if (typeof raw === "string") return raw
  if (raw && typeof raw.toString === "function") return raw.toString("utf8")
  // Fallback: re-serialize the parsed body. Signature verification will only
  // pass against this if the upstream secret is unset (dev), which is fine.
  return req.body ? JSON.stringify(req.body) : ""
}

function header(req: MedusaRequest, name: string): string {
  const headers = (req.headers || {}) as any
  return (
    headers[name] ||
    headers[name.toLowerCase()] ||
    (typeof headers.get === "function" ? headers.get(name) : "") ||
    ""
  )
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verify the Stripe-Signature header. Returns true when the signature is valid
 * for at least one v1 scheme entry within the tolerance window. If no secret is
 * configured we accept (dev/staging) but log a warning so it is visible.
 */
function verifyStripeSignature(
  req: MedusaRequest,
  rawBody: string,
  logger?: any
): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || ""
  if (!secret) {
    logger?.warn?.(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — accepting unsigned webhook"
    )
    return true
  }

  const sigHeader = header(req, "stripe-signature")
  if (!sigHeader) return false

  let timestamp = ""
  const signatures: string[] = []
  for (const part of sigHeader.split(",")) {
    const [key, value] = part.split("=")
    if (key === "t") timestamp = value
    else if (key === "v1" && value) signatures.push(value)
  }
  if (!timestamp || !signatures.length) return false

  const tsNum = Number(timestamp)
  if (Number.isFinite(tsNum)) {
    const age = Math.abs(Date.now() / 1000 - tsNum)
    if (age > SIGNATURE_TOLERANCE_SECONDS) return false
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")

  return signatures.some((candidate) => constantTimeEquals(candidate, expected))
}

/**
 * Stripe `payment_intent.payment_failed` webhook.
 *
 * MONEY-CRITICAL: when a PaymentIntent fails for an order that has ALREADY been
 * marked `charged_ready_to_ship` (fulfillment gate lifted, QBD invoice queued,
 * customer emailed), an iced box may already be moving against a charge that
 * just failed. Page immediately.
 *
 * Stripe dashboard webhook URL to configure:
 *   https://<medusa-admin-host>/webhooks/stripe/payment-failed
 *   Event: payment_intent.payment_failed
 *   Signing secret -> STRIPE_WEBHOOK_SECRET env var.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  let logger: any
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  const rawBody = rawBodyString(req)

  if (!verifyStripeSignature(req, rawBody, logger)) {
    res.status(400).json({ ok: false, error: "invalid_signature" })
    return
  }

  const event = (req.body || {}) as Record<string, any>
  const type = String(event.type || "")

  // Acknowledge everything else with 200 so Stripe does not retry; only act on
  // the failure event we care about.
  if (type !== "payment_intent.payment_failed") {
    res.status(200).json({ ok: true, ignored: type })
    return
  }

  const paymentIntent = (event.data?.object || {}) as Record<string, any>
  const paymentIntentId = String(paymentIntent.id || "")
  if (!paymentIntentId) {
    res.status(200).json({ ok: true, ignored: "missing_payment_intent_id" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  // Find the finalization row this PaymentIntent belongs to. Only the
  // final-charge flow stores stripe_payment_intent_id here.
  const finalizationRows = await db("gp_order_finalization")
    .select(["id", "order_id", "status"])
    .where({ stripe_payment_intent_id: paymentIntentId })
    .orderBy("updated_at", "desc")
    .limit(1)
  const finalization = (finalizationRows?.[0] || null) as {
    id?: string
    order_id?: string
    status?: string
  } | null

  const markedReady =
    finalization?.status === FINALIZATION_CHARGED_READY_TO_SHIP

  if (!finalization?.order_id || !markedReady) {
    // PI not tied to a ready-to-ship order — nothing to page about. (A normal
    // charge-attempt failure is already handled by charge_failed_hold.)
    res.status(200).json({ ok: true, acted: false })
    return
  }

  const lastError = (paymentIntent.last_payment_error || {}) as Record<
    string,
    any
  >
  const failureCode =
    lastError.code || lastError.decline_code || paymentIntent.status || null
  const failureMessage =
    lastError.message || "PaymentIntent failed after order marked ready to ship."

  await emitChargeFailedPostShipAlert({
    logger,
    orderId: finalization.order_id,
    finalizationId: finalization.id || null,
    paymentIntentId,
    paymentIntentStatus: paymentIntent.status || null,
    failureCode,
    failureMessage,
  })

  res.status(200).json({ ok: true, acted: true })
}
