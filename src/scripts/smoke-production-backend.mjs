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

function chooseProductVariant(products) {
  for (const product of products) {
    const variant = product.variants?.find((candidate) => candidate?.id)
    if (variant?.id) {
      return { product, variant }
    }
  }
  return null
}

function positiveNumber(...values) {
  return values.some((value) => Number.isFinite(value) && value > 0)
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
  `${backendUrl}/store/products?limit=25`,
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
    .slice(0, 5)
    .join(", ")})`
)

const region = regions.body.regions[0]
assert(region?.id, "Expected the first region to have an id")

const selection = chooseProductVariant(products.body.products)
assert(
  selection,
  "Expected at least one product with a variant id for cart smoke testing"
)

const cartCreate = await requestJson("cart create", `${backendUrl}/store/carts`, {
  method: "POST",
  headers: {
    ...storeHeaders,
    "content-type": "application/json",
  },
  body: JSON.stringify({ region_id: region.id }),
})
const cartId = cartCreate.body?.cart?.id
assert(cartId, "Expected cart create to return cart.id")

const cartLine = await requestJson(
  "cart add line item",
  `${backendUrl}/store/carts/${cartId}/line-items`,
  {
    method: "POST",
    headers: {
      ...storeHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      variant_id: selection.variant.id,
      quantity: 1,
    }),
  }
)
const cart = cartLine.body?.cart
const item = cart?.items?.[0]
assert(cart?.id === cartId, "Expected cart add response to return the same cart")
assert(item?.id, "Expected cart to contain a line item after add-to-cart")
assert(
  positiveNumber(cart.subtotal, cart.total, item.unit_price, item.subtotal),
  "Expected cart add response to include positive live pricing totals"
)
console.log(
  `ok cart create/add (${cartId}, ${
    selection.product.title || selection.product.handle || selection.product.id
  })`
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
