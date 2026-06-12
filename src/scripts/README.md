# Custom CLI Script

A custom CLI script is a function to execute through Medusa's CLI tool. This is useful when creating custom Medusa tooling to run as a CLI tool.

> Learn more about custom CLI scripts in [this documentation](https://docs.medusajs.com/learn/fundamentals/custom-cli-scripts).

## How to Create a Custom CLI Script?

To create a custom CLI script, create a TypeScript or JavaScript file under the `src/scripts` directory. The file must default export a function.

For example, create the file `src/scripts/my-script.ts` with the following content:

```ts title="src/scripts/my-script.ts"
import { 
  ExecArgs,
} from "@medusajs/framework/types"

export default async function myScript ({
  container
}: ExecArgs) {
  const productModuleService = container.resolve("product")

  const [, count] = await productModuleService.listAndCountProducts()

  console.log(`You have ${count} product(s)`)
}
```

The function receives as a parameter an object having a `container` property, which is an instance of the Medusa Container. Use it to resolve resources in your Medusa application.

---

## How to Run Custom CLI Script?

To run the custom CLI script, run the `exec` command:

```bash
npx medusa exec ./src/scripts/my-script.ts
```

---

## Custom CLI Script Arguments

Your script can accept arguments from the command line. Arguments are passed to the function's object parameter in the `args` property.

For example:

```ts
import { ExecArgs } from "@medusajs/framework/types"

export default async function myScript ({
  args
}: ExecArgs) {
  console.log(`The arguments you passed: ${args}`)
}
```

Then, pass the arguments in the `exec` command after the file path:

```bash
npx medusa exec ./src/scripts/my-script.ts arg1 arg2
```

---

## Legacy Customer Reorder Smoke Test

Use `smoke-legacy-reorder-flow.ts` after customer/order imports or auth changes. It samples an imported legacy customer with a source password, logs in through `/store/legacy-auth/login`, then verifies the returned customer token can load saved addresses, QuickBooks-backed purchase history, and legacy order history. Output is aggregate-only; it does not print customer identifiers, email addresses, or passwords.

```bash
./node_modules/.bin/medusa exec ./src/scripts/smoke-legacy-reorder-flow.ts \
  -- \
  --backend-url https://grillers-medusa-admin-production.up.railway.app \
  --storefront-url https://grillers-medusa-frontend.vercel.app \
  --publishable-key pk_...
```

## Production Backend Smoke Test

Use this after the Railway Medusa service has been redeployed and before
pointing the storefront at it or declaring the backend restored.

```bash
yarn smoke:production-backend \
  --backend-url https://grillers-medusa-admin-production.up.railway.app
```

The script requires `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`. When
`MEDUSA_ADMIN_API_TOKEN` is set, it also verifies admin routes used by staff
flows. It fails on Railway fallback errors, invalid publishable-key behavior,
empty catalog responses, the default Medusa seed product catalog, and broken
cart create/add-to-cart/live-pricing behavior. It selects the cart region from
`--country-code`, `NEXT_PUBLIC_DEFAULT_REGION`, or `us` by default, and fetches
products for that region before testing cart pricing. If the first returned
variant cannot be added to a cart, the script tries additional catalog variants
before failing the smoke.

## WWEX / Unishippers Speedship Smoke Test

Use this after WWEX staging or production credentials are configured in the
environment. The script quotes small-parcel UPS services through the same
Speedship client used by checkout and pack/finalize. It does not print OAuth
tokens, client secrets, raw API responses, labels, or customer data.

Required environment variables:

- `WWEX_AUTH_URL`
- `WWEX_API_BASE_URL`
- `WWEX_CLIENT_ID`
- `WWEX_CLIENT_SECRET`
- `WWEX_AUDIENCE`
- `WWEX_ORIGIN_ADDRESS_1`
- `WWEX_ORIGIN_CITY`
- `WWEX_ORIGIN_STATE`
- `WWEX_ORIGIN_POSTAL_CODE`
- `WWEX_ORIGIN_PHONE`

Optional booking/label variables:

- `WWEX_BILL_TO_ACCOUNT_NBR`
- `WWEX_BILL_TO_POSTAL_CODE`
- `WWEX_BILL_TO_COUNTRY_CODE`
- `WWEX_BILL_TO_TYPE`
- `WWEX_BOOK_SHIPMENTS_ON_RELEASE=true`
- `WWEX_FETCH_LABEL_ON_RELEASE=true`
- `WWEX_NOTIFICATION_EMAIL`

Optional package-estimation variables:

- `WWEX_DEFAULT_PACKAGE_WEIGHT_LB`
- `WWEX_MAX_PACKAGE_WEIGHT_LB`
- `WWEX_DEFAULT_PACKAGE_LENGTH_IN`
- `WWEX_DEFAULT_PACKAGE_WIDTH_IN`
- `WWEX_DEFAULT_PACKAGE_HEIGHT_IN`
- `WWEX_PACKAGE_DIMENSIONS_JSON`

Example:

```bash
yarn smoke:wwex \
  --postal-code 75219 \
  --city "Highland Park" \
  --state TX \
  --weight-lb 5 \
  --service ALL
```

`WWEX_BOOK_SHIPMENTS_ON_RELEASE` intentionally defaults off. With it off,
pack/finalize can still use WWEX for final packed-box rates when credentials
are present, but it will not create a UPS shipment or label.

## Production Backend Recovery Runner

Once Railway is available again, run the recovery runner from this repo. It
checks Railway, deploys the current backend, runs the backend smoke test, then
runs the storefront/backend smoke test from the sibling frontend repo.

```bash
yarn recover:production-backend --wait
```

After `railway up --detach`, the runner waits for the configured backend
`/health` endpoint to return `OK` before running deeper store/admin/cart checks.
Use `--backend-attempts` and `--backend-delay-ms` to tune that post-deploy wait.
If you pass `--backend-url`, that same URL is used for the backend health wait,
the backend smoke test, and the storefront/backend smoke test.

Use `--skip-deploy` if the service was already redeployed from the Railway
dashboard or an automatic GitHub deploy; this bypasses the Railway CLI readiness
check and verifies the configured backend URL directly, so the Railway CLI does
not need to be available for that path. Use `--skip-backend-wait` only when you
intentionally want to run smoke checks immediately. Use `--skip-frontend` if you
only want to verify the Medusa backend.
Use `--require-github-deployment` when validating a Railway/GitHub auto-deploy;
it verifies the latest `grillers / production` deployment record matches the
current git commit before accepting the backend smoke result.

### Manual GitHub Recovery Deploy

If the local Railway CLI session is stale or unavailable, use the
`Manual Railway Backend Deploy` GitHub Actions workflow. It uploads the current
backend to Railway with `railway up`, waits for `/health` to return `OK`, then
runs `yarn smoke:production-backend`.

Required repository secret:

- `RAILWAY_TOKEN`

Required repository variables, or equivalent workflow-dispatch inputs:

- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `RAILWAY_SERVICE_ID`
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY`

Optional repository variable:

- `NEXT_PUBLIC_DEFAULT_REGION` defaults to `us`

Trigger it from GitHub Actions, or with the GitHub CLI after the secret and
variables are present:

```bash
gh workflow run "Manual Railway Backend Deploy" \
  -R mintpixels/grillers-medusa-admin \
  -f backend_url=https://grillers-medusa-admin-production.up.railway.app
```

## Legacy Auth Password Audit

Use `audit-legacy-auth-passwords.ts` to prove imported auth hashes still verify the source legacy-site passwords. It compares source credentials against Medusa provider hashes without printing emails or passwords.

```bash
./node_modules/.bin/medusa exec ./src/scripts/audit-legacy-auth-passwords.ts \
  -- \
  --concurrency 4
```

If the audit finds legacy passwords that are not covered by any provider hash,
use `backfill-legacy-auth-password-fallbacks.ts`. It preserves current Medusa
passwords and adds a legacy-only fallback provider hash for the storefront
legacy login path.

```bash
./node_modules/.bin/medusa exec ./src/scripts/backfill-legacy-auth-password-fallbacks.ts \
  -- \
  --apply \
  --concurrency 4
```

If the audit finds an auth identity attached to multiple mapped customers, use
`repair-legacy-shared-auth-identities.ts` first. It splits only the mismatched
legacy map onto a fresh auth identity and moves that map's email/username
provider rows.

```bash
./node_modules/.bin/medusa exec ./src/scripts/repair-legacy-shared-auth-identities.ts \
  -- \
  --apply
```

If the broader projection audit reports `expected_email_login_password_missing`,
use `repair-legacy-email-login-providers.ts`. It creates or repairs the
canonical email provider row from an existing verified provider hash, preserving
the source legacy password for primary email/password login.

```bash
./node_modules/.bin/medusa exec ./src/scripts/repair-legacy-email-login-providers.ts \
  -- \
  --apply
```
