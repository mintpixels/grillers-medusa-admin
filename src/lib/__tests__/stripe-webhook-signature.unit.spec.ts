import { createHmac } from "node:crypto"
import {
  rawStripeWebhookBody,
  stripeSignatureHeader,
  verifyStripeWebhookSignature,
} from "../stripe-webhook-signature"

const SECRET = "whsec_unit_test"
const NOW_MS = 1_700_000_000_000
const RAW_BODY = '{"id":"evt_123","type":"payment_intent.payment_failed"}'

function signature(
  rawBody = RAW_BODY,
  timestamp = Math.floor(NOW_MS / 1000),
  secret = SECRET
) {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex")
  return `t=${timestamp},v1=${digest}`
}

describe("Stripe webhook signature verification", () => {
  it("accepts a current signature over the exact raw body", () => {
    expect(
      verifyStripeWebhookSignature({
        rawBody: RAW_BODY,
        signatureHeader: signature(),
        secret: SECRET,
        nowMs: NOW_MS,
      })
    ).toEqual({ ok: true })
  })

  it("accepts any matching v1 entry during a Stripe secret roll", () => {
    const matching = signature().split("v1=")[1]
    expect(
      verifyStripeWebhookSignature({
        rawBody: RAW_BODY,
        signatureHeader: `t=1700000000,v1=${"0".repeat(64)},v1=${matching}`,
        secret: SECRET,
        nowMs: NOW_MS,
      })
    ).toEqual({ ok: true })
  })

  it.each([
    {
      label: "missing raw body",
      rawBody: null,
      signatureHeader: signature(),
      reason: "missing_raw_body",
    },
    {
      label: "missing header",
      rawBody: RAW_BODY,
      signatureHeader: "",
      reason: "missing_signature",
    },
    {
      label: "malformed header",
      rawBody: RAW_BODY,
      signatureHeader: "v1=bad",
      reason: "malformed_signature",
    },
    {
      label: "stale timestamp",
      rawBody: RAW_BODY,
      signatureHeader: signature(RAW_BODY, 1_699_999_000),
      reason: "timestamp_outside_tolerance",
    },
    {
      label: "wrong secret",
      rawBody: RAW_BODY,
      signatureHeader: signature(
        RAW_BODY,
        1_700_000_000,
        "whsec_other_endpoint"
      ),
      reason: "signature_mismatch",
    },
    {
      label: "mutated body",
      rawBody: `${RAW_BODY}\n`,
      signatureHeader: signature(),
      reason: "signature_mismatch",
    },
  ])("fails closed for $label", ({ rawBody, signatureHeader, reason }) => {
    expect(
      verifyStripeWebhookSignature({
        rawBody,
        signatureHeader,
        secret: SECRET,
        nowMs: NOW_MS,
      })
    ).toEqual({ ok: false, reason })
  })

  it("extracts only an exact preserved raw body and a scalar signature", () => {
    expect(rawStripeWebhookBody({ rawBody: Buffer.from(RAW_BODY) })).toBe(
      RAW_BODY
    )
    expect(rawStripeWebhookBody({ rawBody: undefined })).toBeNull()
    expect(
      stripeSignatureHeader({
        "stripe-signature": signature(),
      })
    ).toBe(signature())
    expect(
      stripeSignatureHeader({
        "stripe-signature": [signature()],
      })
    ).toBe("")
  })
})
