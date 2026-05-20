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
cart create/add-to-cart/live-pricing behavior.

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
