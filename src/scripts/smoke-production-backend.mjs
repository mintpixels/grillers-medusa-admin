#!/usr/bin/env node

import fs from "node:fs"
import process from "node:process"

const DEFAULT_BACKEND_URL =
  "https://grillers-medusa-admin-production.up.railway.app"

function readDotEnv(file = ".env") {
  if (!fs.existsSync(file)) return {}

  const env = {}
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue

    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function getArg(name) {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function normalizeUrl(url) {
  return (url || "").replace(/\/+$/, "")
}

async function requestJson(label, url, options = {}) {
  const startedAt = Date.now()
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    ...options,
    headers: {
      accept: "application/json",
      ...(options.headers || {}),
    },
  })
  const bodyText = await response.text()
  const elapsed = Date.now() - startedAt

  let body = null
  try {
    body = bodyText ? JSON.parse(bodyText) : null
  } catch {
    body = null
  }

  if (!response.ok) {
    const preview = bodyText.replace(/\s+/g, " ").slice(0, 500)
    throw new Error(
      `${label} failed: HTTP ${response.status} in ${elapsed}ms. Body: ${preview}`
    )
  }

  return { body, bodyText, elapsed, status: response.status }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const dotEnv = readDotEnv()
const backendUrl = normalizeUrl(
  getArg("backend-url") ||
    process.env.MEDUSA_BACKEND_URL ||
    dotEnv.MEDUSA_BACKEND_URL ||
    DEFAULT_BACKEND_URL
)
const publishableKey =
  getArg("publishable-key") ||
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ||
  dotEnv.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const adminToken =
  getArg("admin-token") ||
  process.env.MEDUSA_ADMIN_API_TOKEN ||
  dotEnv.MEDUSA_ADMIN_API_TOKEN

assert(backendUrl, "Missing backend URL")
assert(publishableKey, "Missing NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")

const storeHeaders = {
  "x-publishable-api-key": publishableKey,
}

console.log(`Checking Medusa backend: ${backendUrl}`)

const health = await requestJson("health", `${backendUrl}/health`, {
  headers: { accept: "text/plain,application/json" },
})
assert(
  health.bodyText.trim() === "OK",
  `Expected /health to return OK, got ${JSON.stringify(health.bodyText)}`
)
console.log(`ok /health (${health.elapsed}ms)`)

const regions = await requestJson(
  "store regions",
  `${backendUrl}/store/regions`,
  { headers: storeHeaders }
)
assert(
  Array.isArray(regions.body?.regions) && regions.body.regions.length > 0,
  "Expected /store/regions to return at least one region"
)
console.log(`ok /store/regions (${regions.body.regions.length} regions)`)

const products = await requestJson(
  "store products",
  `${backendUrl}/store/products?limit=5&fields=id,title,handle,status`,
  { headers: storeHeaders }
)
assert(
  Array.isArray(products.body?.products) && products.body.products.length > 0,
  "Expected /store/products to return products"
)
assert(
  !products.body.products.some((product) => product.title === "Medusa T-Shirt"),
  "Backend appears to be serving Medusa seed data instead of the Griller's Pride catalog"
)
console.log(
  `ok /store/products (${products.body.products
    .map((product) => product.title || product.handle || product.id)
    .join(", ")})`
)

if (adminToken) {
  const adminHeaders = { authorization: `Bearer ${adminToken}` }
  const store = await requestJson("admin store", `${backendUrl}/admin/store`, {
    headers: adminHeaders,
  })
  assert(store.body?.store, "Expected /admin/store to return a store object")
  console.log("ok /admin/store")

  const orders = await requestJson(
    "admin orders",
    `${backendUrl}/admin/orders?limit=1`,
    { headers: adminHeaders }
  )
  assert(
    Array.isArray(orders.body?.orders),
    "Expected /admin/orders to return an orders array"
  )
  console.log(`ok /admin/orders (${orders.body.orders.length} sampled)`)
} else {
  console.log("skipped admin checks; MEDUSA_ADMIN_API_TOKEN is not set")
}

console.log("Production backend smoke check passed.")
