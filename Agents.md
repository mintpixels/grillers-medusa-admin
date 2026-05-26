# Agent Notes: Medusa Backend/Admin Repo

Canonical full-project repo guide:

```text
/Users/aviswerdlow/coding/grillerspride/Agents.md
```

This repository is `mintpixels/grillers-medusa-admin`. It owns the Medusa backend/admin on Railway: products, variants, carts, customers, orders, checkout/payment/fulfillment backend behavior, and server-side analytics subscribers.

Before editing, run:

```bash
git status --short
git branch --show-current
git remote -v
```

Do not stage unrelated dirty files. This repo may contain local analysis artifacts or subscriber work.

Common checks:

```bash
yarn test:unit
yarn build
yarn smoke:production-backend
```

Critical contracts:

- Preserve Chris's Jitsu/Railway eventing work.
- `order_completed` must originate server-side from the `order.placed` subscriber.
- Checkout, shipping, payment, fulfillment, and order subscribers affect live revenue. Add focused tests when touching them.
- Do not run destructive migrations, recovery scripts, or production data operations without explicit user direction.
- QuickBooks SKUs/names are mutable operational fields. Persist and propagate the QuickBooks item `ListID` (`qbd_list_id`, also called the item hex/item name id) on products, variants, carts, order line items, and staff action metadata when available.
- QuickBooks matching logic should prefer `qbd_list_id`/`ListID`, then stable Medusa variant/product IDs, with SKU only as a fallback. Do not introduce new order or fulfillment logic that assumes QuickBooks SKU is permanent.
- Customer emails and staff/customer-facing summaries should use Medusa/Strapi product titles, not QuickBooks accounting titles or seasonal sorting prefixes.
- Medusa-to-Strapi product updates must fail closed when the existing Strapi product cannot be read; never fall back to writing QuickBooks/raw Medusa titles, descriptions, media, categorization, SEO, recipes, or merchandising fields over Strapi content.
- Medusa product deletion must not delete Strapi products by default. Destructive Strapi sync requires a verified Strapi backup, a written cutover plan, and the explicit `STRAPI_ALLOW_DESTRUCTIVE_SYNC=true` backend switch.
