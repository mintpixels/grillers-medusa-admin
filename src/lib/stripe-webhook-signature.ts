import { createHmac, timingSafeEqual } from "node:crypto"

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300

export type StripeSignatureFailureReason =
  | "missing_raw_body"
  | "missing_signature"
  | "malformed_signature"
  | "timestamp_outside_tolerance"
  | "signature_mismatch"

export type StripeSignatureVerdict =
  | { ok: true }
  | { ok: false; reason: StripeSignatureFailureReason }

export function rawStripeWebhookBody(request: {
  rawBody?: unknown
}): string | null {
  const rawBody = request.rawBody
  if (typeof rawBody === "string") return rawBody
  if (Buffer.isBuffer(rawBody)) return rawBody.toString("utf8")
  if (rawBody instanceof Uint8Array) {
    return Buffer.from(rawBody).toString("utf8")
  }
  return null
}

export function stripeSignatureHeader(headers: unknown): string {
  if (!headers || typeof headers !== "object") return ""

  const headerRecord = headers as Record<string, unknown>
  const direct =
    headerRecord["stripe-signature"] ?? headerRecord["Stripe-Signature"]
  if (typeof direct === "string") return direct

  const get = (headers as { get?: unknown }).get
  if (typeof get === "function") {
    const value = get.call(headers, "stripe-signature")
    return typeof value === "string" ? value : ""
  }

  return ""
}

function constantTimeHexEquals(candidate: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(candidate)) return false

  const candidateBuffer = Buffer.from(candidate, "hex")
  const expectedBuffer = Buffer.from(expected, "hex")
  return timingSafeEqual(candidateBuffer, expectedBuffer)
}

/**
 * Verifies Stripe's `t=<unix>,v1=<hmac>` signature over the exact raw body.
 * Multiple v1 entries are accepted so Stripe's bounded secret-rotation window
 * continues to work. Parsed/re-serialized JSON is deliberately not accepted.
 */
export function verifyStripeWebhookSignature(input: {
  rawBody: string | null
  signatureHeader: string
  secret: string
  nowMs?: number
  toleranceSeconds?: number
}): StripeSignatureVerdict {
  if (input.rawBody === null) {
    return { ok: false, reason: "missing_raw_body" }
  }
  if (!input.signatureHeader) {
    return { ok: false, reason: "missing_signature" }
  }

  let timestamp = ""
  const signatures: string[] = []
  for (const rawPart of input.signatureHeader.split(",")) {
    const part = rawPart.trim()
    const separatorIndex = part.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = part.slice(0, separatorIndex)
    const value = part.slice(separatorIndex + 1)
    if (key === "t") timestamp = value
    if (key === "v1" && value) signatures.push(value)
  }

  if (!/^\d+$/.test(timestamp) || signatures.length === 0) {
    return { ok: false, reason: "malformed_signature" }
  }

  const timestampSeconds = Number(timestamp)
  if (!Number.isSafeInteger(timestampSeconds)) {
    return { ok: false, reason: "malformed_signature" }
  }

  const nowMs = input.nowMs ?? Date.now()
  const toleranceSeconds =
    input.toleranceSeconds ?? STRIPE_SIGNATURE_TOLERANCE_SECONDS
  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds)
  if (ageSeconds > toleranceSeconds) {
    return { ok: false, reason: "timestamp_outside_tolerance" }
  }

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`, "utf8")
    .digest("hex")

  if (
    !signatures.some((candidate) =>
      constantTimeHexEquals(candidate, expected)
    )
  ) {
    return { ok: false, reason: "signature_mismatch" }
  }

  return { ok: true }
}
