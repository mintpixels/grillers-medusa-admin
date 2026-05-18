import mysql from "mysql2/promise"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  envVarsAreSet,
  getNumberArg,
  getStringArg,
  loadEnvFilesUntil,
  parseArgs,
  requiredEnv,
  toNumber,
} from "./lib/legacy-import-utils"

type CandidateRow = {
  legacy_customer_id: string
  legacy_username: string | null
  email_lower: string | null
  medusa_customer_id: string
  legacy_order_count: string | number
  legacy_line_count: string | number
}

type SourceCustomerRow = {
  ID: string | number
  EMAIL: string | null
  USERNAME: string | null
  PASSWORD: string | null
}

type FetchJsonResult = {
  ok: boolean
  status: number
  body: any
}

function legacyEnvIsAvailable() {
  return envVarsAreSet([
    "LEGACY_DB_HOST",
    "LEGACY_DB_NAME",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
  ])
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "")
}

async function fetchJson(url: string, init: RequestInit): Promise<FetchJsonResult> {
  const res = await fetch(url, init)
  const text = await res.text()
  let body: any = null

  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text.slice(0, 200) }
  }

  return { ok: res.ok, status: res.status, body }
}

function candidateIdentifiers(candidate: CandidateRow) {
  return [candidate.legacy_username, candidate.email_lower]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
}

async function loadSourcePasswords(candidateIds: string[]) {
  const legacyConnectionConfig = {
    host: requiredEnv("LEGACY_DB_HOST"),
    port: Number(process.env.LEGACY_DB_PORT || 3306),
    database: requiredEnv("LEGACY_DB_NAME"),
    user: requiredEnv("LEGACY_DB_USER"),
    password: requiredEnv("LEGACY_DB_PASSWORD"),
    connectTimeout: 20000,
    ssl: process.env.LEGACY_DB_SSL === "1" ? {} : undefined,
  }

  const connection = await mysql.createConnection(legacyConnectionConfig)
  try {
    const placeholders = candidateIds.map(() => "?").join(",")
    const [rows] = await connection.query(
      `select ID, EMAIL, USERNAME, PASSWORD
       from CUSTOMERS
       where ID in (${placeholders})
         and NULLIF(TRIM(PASSWORD), '') is not null`,
      candidateIds
    )

    return new Map(
      (rows as SourceCustomerRow[]).map((row) => [String(row.ID), row])
    )
  } finally {
    await connection.end().catch(() => undefined)
  }
}

async function loadCandidates(db: any, limit: number): Promise<CandidateRow[]> {
  const result = await db.raw(
    `
      select
        m.legacy_customer_id,
        m.legacy_username,
        m.email_lower,
        m.medusa_customer_id,
        count(distinct lo.id)::int as legacy_order_count,
        count(lol.id)::int as legacy_line_count
      from legacy_customer_map m
      join legacy_order lo on lo.deleted_at is null
        and (
          lo.medusa_customer_id = m.medusa_customer_id
          or (
            lo.legacy_customer_id is not null
            and lo.legacy_customer_id = m.legacy_customer_id
          )
          or (
            lo.qbd_customer_list_id is not null
            and lo.qbd_customer_list_id = m.qbd_customer_list_id
          )
          or (
            lo.email_lower is not null
            and lo.email_lower = m.email_lower
          )
        )
      join legacy_order_line lol
        on lol.legacy_order_id = lo.id
       and lol.deleted_at is null
      where m.deleted_at is null
        and m.medusa_customer_id is not null
        and m.medusa_auth_identity_id is not null
        and coalesce(m.auth_import_status, '') <> 'no_password'
        and coalesce(m.email_lower, '') <> ''
        and coalesce(lol.mapping_status, '') in ('mapped', 'staff_assisted')
      group by
        m.legacy_customer_id,
        m.legacy_username,
        m.email_lower,
        m.medusa_customer_id
      having count(distinct lo.id) > 0 and count(lol.id) > 0
      order by count(distinct lo.id) desc, count(lol.id) desc
      limit ?
    `,
    [limit]
  )

  return (result.rows ?? result) as CandidateRow[]
}

export default async function smokeLegacyReorderFlow({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const limit = Math.max(getNumberArg(args, ["limit"], 50), 1)
  const envFile = getStringArg(args, ["env-file", "legacy-env-file"])
  const backendUrl = normalizeBaseUrl(
    getStringArg(args, ["backend-url"], process.env.MEDUSA_BACKEND_URL) ||
      "http://localhost:9000"
  )
  const publishableKey =
    getStringArg(args, ["publishable-key"], process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY) ||
    ""

  const loadedEnv = loadEnvFilesUntil(
    [
      envFile,
      process.env.LEGACY_ENV_FILE,
      process.env.ENV_FILE,
      ".env.legacy",
      ".env.local",
      ".env",
      "../grillerspride/.env.legacy",
      "../grillerspride/.env",
    ],
    legacyEnvIsAvailable
  )

  if (!legacyEnvIsAvailable()) {
    throw new Error("Legacy DB env vars are required for smoke login sampling")
  }
  if (!publishableKey) {
    throw new Error("Pass --publishable-key or set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY")
  }

  const candidates = await loadCandidates(db, limit)
  if (!candidates.length) {
    throw new Error("No imported legacy customers with mapped reorder history found")
  }

  const sourceById = await loadSourcePasswords(
    candidates.map((candidate) => String(candidate.legacy_customer_id))
  )

  const attempts: Array<{ status: number; identifierType: string }> = []
  let success: Record<string, unknown> | null = null

  for (const candidate of candidates) {
    const source = sourceById.get(String(candidate.legacy_customer_id))
    const password = String(source?.PASSWORD ?? "")
    if (!password) {
      continue
    }

    for (const identifier of candidateIdentifiers(candidate)) {
      const identifierType = identifier.includes("@") ? "email" : "username"
      const login = await fetchJson(`${backendUrl}/store/legacy-auth/login`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-publishable-api-key": publishableKey,
        },
        body: JSON.stringify({ identifier, password }),
      })

      attempts.push({ status: login.status, identifierType })

      const token =
        login.body && typeof login.body.token === "string"
          ? login.body.token
          : null
      if (!login.ok || !token) {
        continue
      }

      const authHeaders = {
        authorization: `Bearer ${token}`,
        "x-publishable-api-key": publishableKey,
      }
      const customer = await fetchJson(
        `${backendUrl}/store/customers/me?fields=${encodeURIComponent(
          "*addresses,+metadata"
        )}`,
        { headers: authHeaders }
      )
      const purchaseHistory = await fetchJson(
        `${backendUrl}/store/legacy-order-history/purchase-history`,
        { headers: authHeaders }
      )
      const orders = await fetchJson(
        `${backendUrl}/store/legacy-order-history/orders?limit=5&offset=0`,
        { headers: authHeaders }
      )

      const customerBody = customer.body?.customer ?? null
      const items = Array.isArray(purchaseHistory.body?.purchase_history)
        ? purchaseHistory.body.purchase_history
        : []
      const legacyOrders = Array.isArray(orders.body?.orders)
        ? orders.body.orders
        : []

      success = {
        identifierType,
        customerLoaded: Boolean(customer.ok && customerBody),
        tokenCustomerMatchesCandidate: Boolean(
          customerBody && customerBody.id === candidate.medusa_customer_id
        ),
        hasAccount: Boolean(customerBody?.has_account),
        addressCount: Array.isArray(customerBody?.addresses)
          ? customerBody.addresses.length
          : 0,
        purchaseHistoryStatus: purchaseHistory.status,
        purchaseHistoryCount: items.length,
        reorderablePurchaseHistoryCount: items.filter(
          (item: any) => item.reorderable && item.variantId
        ).length,
        staffAssistedPurchaseHistoryCount: items.filter(
          (item: any) => item.mappingStatus === "staff_assisted"
        ).length,
        legacyOrdersStatus: orders.status,
        legacyOrdersCount: toNumber(orders.body?.count || legacyOrders.length),
        sampledOrdersReturned: legacyOrders.length,
        sampledVisibleLineCount: legacyOrders.reduce(
          (sum: number, order: any) =>
            sum + (Array.isArray(order.lines) ? order.lines.length : 0),
          0
        ),
        sourceCandidateLegacyOrders: toNumber(candidate.legacy_order_count),
        sourceCandidateMappedOrAssistedLines: toNumber(candidate.legacy_line_count),
      }
      break
    }

    if (success) {
      break
    }
  }

  const report = {
    loadedLegacyEnvFiles: loadedEnv.length,
    candidatesQueried: candidates.length,
    candidatesWithSourcePassword: sourceById.size,
    loginAttempts: attempts.length,
    loginSucceeded: Boolean(success),
    result: success,
    failedAttemptStatuses: attempts.slice(0, 10),
  }

  logger.info(`[legacy-reorder-smoke] ${JSON.stringify(report)}`)
  console.log(JSON.stringify(report, null, 2))

  if (
    !success ||
    !success.customerLoaded ||
    !success.tokenCustomerMatchesCandidate ||
    !success.purchaseHistoryCount ||
    !success.legacyOrdersCount
  ) {
    throw new Error("Legacy reorder smoke failed")
  }
}
