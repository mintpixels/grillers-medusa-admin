# Griller's Pride Communications Platform Runbook

This backend owns the first-party customer communication brain. Medusa remains
commerce truth, Stripe remains payment truth, QuickBooks remains accounting
truth, and Postmark remains the email delivery/rendering provider.

## What It Does

- Captures storefront, cart, checkout, order, inventory, email, and staff events
  in `gp_communication_event`.
- Maintains identity and customer profile state in `gp_customer_profile` and
  `gp_identity_map`.
- Tracks cart lifecycle in `gp_cart_lifecycle`, including active, expired, and
  recovered carts.
- Seeds and runs lifecycle flows from `gp_communication_flow` and
  `gp_flow_enrollment`.
- Sends transactional, service, one-to-one marketing, and broadcast email
  through Postmark and logs every attempt in `gp_message_log`.
- Ingests Postmark webhooks to update delivery, open, click, bounce, complaint,
  and unsubscribe state.
- Preserves topic-level suppressions in `gp_suppression_preference`.
- Attributes orders to lifecycle/campaign touches in `gp_attribution`.
- Dual-writes events to ClickHouse and GA4 when their environment variables are
  configured.
- Preserves Constant Contact unsubscribe/bounce state during imports through
  `gp_import_run`.

## Required Environment

- `POSTMARK_API_TOKEN`
- `POSTMARK_FROM`
- `POSTMARK_TRANSACTIONAL_STREAM`
- `POSTMARK_LIFECYCLE_STREAM`
- `POSTMARK_BROADCAST_STREAM`
- `COMMUNICATIONS_API_KEY` or `COMMUNICATIONS_PUBLIC_API_KEY`
- `STOREFRONT_URL`
- `REDIS_URL` or `COMMUNICATIONS_REDIS_URL` for BullMQ workers
- `CLICKHOUSE_URL`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`,
  `CLICKHOUSE_DATABASE` for event warehouse delivery
- `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` for GA4 Measurement Protocol delivery

If Redis is not configured, Medusa scheduled jobs still run a fallback path.
That is acceptable for launch, but BullMQ gives better retry visibility and
background throughput.

## Streams And Purpose

- `transactional`: order confirmation, cancellation, refund, shipped/ready,
  password, account, and staff order notices.
- `lifecycle`: welcome, abandoned cart, post-purchase, reorder, win-back,
  reactivation, holiday reminder, and back-in-stock.
- `broadcast`: manually approved campaigns and newsletters.

Postmark stream and message purpose are separate fields:

- `transactional` purpose: order-critical messages that ignore marketing
  unsubscribe but still respect bounces and complaints.
- `service` purpose: account or staff service messages that are not marketing.
- `marketing_1to1` purpose: personalized lifecycle messages. Cart recovery can
  use the transactional Postmark stream for inbox placement, but still requires
  opt-in and respects topic suppression.
- `broadcast` purpose: broad campaigns/newsletters that require marketing
  consent and use the broadcast stream.

Marketing suppressions must not block order-critical transactional emails, but
marketing-purpose sends must never bypass consent just because they use a
transactional Postmark stream.

## Staff APIs

- `GET /admin/grillers/communications`
- `GET /admin/grillers/communications/profiles`
- `GET /admin/grillers/communications/profiles/:id`
- `POST /admin/grillers/communications/send`
- `GET /admin/grillers/communications/campaigns`
- `POST /admin/grillers/communications/campaigns`
- `POST /admin/grillers/communications/campaigns/:id/send`
- `POST /admin/grillers/communications/flows/run`
- `GET /admin/grillers/communications/reports`
- `GET /admin/grillers/communications/templates`
- `GET /admin/grillers/communications/health`
- `POST /admin/grillers/communications/imports`

## Public/Service APIs

- `POST /api/track`
- `POST /api/batch`
- `POST /api/identify`
- `POST /api/subscribe`
- `GET/PATCH /api/preferences/:token`
- `POST /api/unsubscribe/:token`
- `POST /api/request-preferences-link`
- `POST /api/postmark/webhook`

These are key-authenticated when `COMMUNICATIONS_API_KEY` or
`COMMUNICATIONS_PUBLIC_API_KEY` is set.

## Jobs And Workers

- `gp-communications-flow-runner`: runs due flow enrollments every minute.
- `gp-communications-lifecycle`: refreshes lifecycle stages, segments, carts,
  scheduled campaigns, and due flows daily.
- `yarn communications:worker`: starts BullMQ event, flow, and campaign workers.

Use `POST /admin/grillers/communications/flows/run` for an immediate manual run.

## Safety Rules

- Customer-facing product titles must come from Strapi/Medusa customer-safe
  catalog fields. Never send QuickBooks item names, ListIDs, item hex values, or
  seasonal sorting prefixes to customers.
- Every send needs an idempotency key. Refunds and cancellations must not send
  duplicates if the same event is replayed.
- Preserve Constant Contact unsubscribes and bounces before any migration send.
- Preserve experiment assignment context on events and email message metadata so
  campaign and lifecycle results can be analyzed by variant.
- Medusa-to-Strapi catalog sync must fail closed when the existing Strapi
  product cannot be read. Do not let fallback QuickBooks or raw Medusa titles
  overwrite Strapi merchandising copy.
- Product deletion in Medusa must not delete Strapi records unless a verified
  Strapi backup and written cutover plan exist and
  `STRAPI_ALLOW_DESTRUCTIVE_SYNC=true` is deliberately enabled.
- A Postmark send does not prove an order was paid. Use Medusa and Stripe for
  order/payment truth.
- Attributed revenue is a marketing signal, not accounting revenue.
- ClickHouse and GA4 delivery failures should be visible in health/reporting,
  but they must not block customer checkout or transactional email.

## Verification

Run after code changes:

```bash
yarn build
yarn test:unit
```

Run after environment/deploy changes:

```bash
yarn smoke:production-backend
```

Then open the staff communications console and check:

- Recent message log renders.
- Reports show event, message, cart, delivery, and attribution sections.
- Templates list includes transactional, lifecycle, and broadcast templates.
- Health shows whether queues are configured.
- A staff test email logs to Postmark and `gp_message_log`.
