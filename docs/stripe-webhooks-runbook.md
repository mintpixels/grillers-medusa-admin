# Stripe webhook runbook

Stripe generates a unique signing secret for every endpoint. The two
production endpoints must remain separate:

| Purpose | URL | Exact events | Railway variable |
|---|---|---|---|
| Medusa payment state | `/hooks/payment/stripe_stripe` | `payment_intent.amount_capturable_updated`, `payment_intent.partially_funded`, `payment_intent.payment_failed`, `payment_intent.succeeded` | `STRIPE_WEBHOOK_SECRET` |
| Post-ship payment failure page | `/webhooks/stripe/payment-failed` | `payment_intent.payment_failed` | `STRIPE_PAYMENT_FAILED_WEBHOOK_SECRET` |

Both routes require the exact raw request body and a current valid
`Stripe-Signature`. Missing secrets return `503`; missing, stale, malformed, or
wrong-endpoint signatures return `400`. Neither route has an unsigned
development fallback.

## Secret-safe setup or rotation

1. Create a replacement Stripe endpoint with the exact URL and events above.
2. Capture the create response in a mode-`0600` temporary file. Never print,
   paste, commit, or add its `secret` field to an issue.
3. Pipe only the `secret` value into the corresponding Railway variable with
   `railway variable set --stdin`; do not place it in a shell argument.
4. Deploy and wait for `/health` to pass.
5. Verify a current Stripe-signed delivery returns `2xx`. Also send an unsigned
   request and a request signed with the other endpoint's secret; both must be
   rejected before any processing.
6. Confirm bounded backend logs contain no signature failures for the new
   endpoint.
7. Disable the superseded endpoint only after all checks pass. Keep the old
   endpoint enabled if any verification is incomplete.

The issue or deployment record may contain endpoint IDs, URLs, event names,
HTTP status codes, commit IDs, and timestamps. It must not contain a signing
secret, `Stripe-Signature` header, API key, or raw payment payload.
