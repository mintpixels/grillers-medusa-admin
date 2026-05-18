import mysql from "mysql2/promise"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { verifyEmailpassPasswordHash } from "../lib/emailpass-password"
import {
  envVarsAreSet,
  getNumberArg,
  getStringArg,
  loadEnvFilesUntil,
  parseArgs,
  requiredEnv,
} from "./lib/legacy-import-utils"

type ProviderPasswordRow = {
  legacy_customer_id: string
  email_lower: string | null
  legacy_username: string | null
  medusa_customer_id: string | null
  medusa_auth_identity_id: string | null
  auth_import_status: string | null
  customer_exists: boolean
  has_account: boolean
  auth_customer_id: string | null
  provider_entity_id: string | null
  password_hash: string | null
}

type SourcePasswordRow = {
  ID: string | number
  PASSWORD: string | null
}

type AccountAudit = {
  legacyCustomerId: string
  emailLower: string | null
  username: string | null
  medusaCustomerId: string | null
  authIdentityId: string | null
  customerExists: boolean
  hasAccount: boolean
  authCustomerId: string | null
  providers: Array<{ entityId: string; passwordHash: string }>
}

type GapSample = {
  kind: string
  legacyCustomerId: string
  providerEntityType?: string
  detail?: string
}

const AUTH_PROVIDER = "emailpass"

function legacyEnvIsAvailable() {
  return envVarsAreSet([
    "LEGACY_DB_HOST",
    "LEGACY_DB_NAME",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
  ])
}

function addSample(samples: GapSample[], limit: number, sample: GapSample) {
  if (samples.length < limit) {
    samples.push(sample)
  }
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text || null
}

function normalizeLower(value: unknown): string | null {
  return normalizeText(value)?.toLowerCase() ?? null
}

function providerType(account: AccountAudit, entityId: string) {
  const normalized = entityId.trim()
  const lower = normalized.toLowerCase()
  const emailLower = normalizeLower(account.emailLower)
  const username = normalizeText(account.username)
  const usernameLower = username?.toLowerCase() ?? null

  if (emailLower && lower === emailLower) {
    return "email"
  }
  if (username && normalized === username) {
    return "username_exact"
  }
  if (usernameLower && lower === usernameLower) {
    return "username_lower"
  }
  return "other"
}

async function loadSourcePasswords(legacyCustomerIds: string[]) {
  if (!legacyCustomerIds.length) {
    return new Map<string, string>()
  }

  const connection = await mysql.createConnection({
    host: requiredEnv("LEGACY_DB_HOST"),
    port: Number(process.env.LEGACY_DB_PORT || 3306),
    database: requiredEnv("LEGACY_DB_NAME"),
    user: requiredEnv("LEGACY_DB_USER"),
    password: requiredEnv("LEGACY_DB_PASSWORD"),
    connectTimeout: 20000,
    ssl: process.env.LEGACY_DB_SSL === "1" ? {} : undefined,
  })

  try {
    const byId = new Map<string, string>()
    const batchSize = 1000

    for (let i = 0; i < legacyCustomerIds.length; i += batchSize) {
      const batch = legacyCustomerIds.slice(i, i + batchSize)
      const placeholders = batch.map(() => "?").join(",")
      const [rows] = await connection.query(
        `select ID, PASSWORD
         from CUSTOMERS
         where ID in (${placeholders})
           and NULLIF(TRIM(PASSWORD), '') is not null`,
        batch
      )

      for (const row of rows as SourcePasswordRow[]) {
        const password = normalizeText(row.PASSWORD)
        if (password) {
          byId.set(String(row.ID), password)
        }
      }
    }

    return byId
  } finally {
    await connection.end().catch(() => undefined)
  }
}

async function loadProviderRows(db: any, limit: number, offset: number) {
  const limitSql = limit > 0 ? "limit ? offset ?" : ""
  const params = limit > 0 ? [limit, offset] : []
  const result = await db.raw(
    `
      select
        m.legacy_customer_id,
        m.email_lower,
        m.legacy_username,
        m.medusa_customer_id,
        m.medusa_auth_identity_id,
        m.auth_import_status,
        (c.id is not null) as customer_exists,
        coalesce(c.has_account, false) as has_account,
        ai.app_metadata->>'customer_id' as auth_customer_id,
        pi.entity_id as provider_entity_id,
        pi.provider_metadata->>'password' as password_hash
      from legacy_customer_map m
      left join customer c
        on c.id = m.medusa_customer_id
       and c.deleted_at is null
      left join auth_identity ai
        on ai.id = m.medusa_auth_identity_id
       and ai.deleted_at is null
      left join provider_identity pi
        on pi.auth_identity_id = m.medusa_auth_identity_id
       and pi.provider = ?
       and pi.deleted_at is null
       and pi.provider_metadata->>'password' is not null
      where m.deleted_at is null
        and m.medusa_auth_identity_id is not null
        and coalesce(m.auth_import_status, '') <> 'no_password'
      order by m.legacy_customer_id::numeric nulls last, m.legacy_customer_id
      ${limitSql}
    `,
    [AUTH_PROVIDER, ...params]
  )

  return (result.rows ?? result) as ProviderPasswordRow[]
}

function groupAccounts(rows: ProviderPasswordRow[]) {
  const accounts = new Map<string, AccountAudit>()

  for (const row of rows) {
    const legacyCustomerId = String(row.legacy_customer_id)
    const account =
      accounts.get(legacyCustomerId) ??
      {
        legacyCustomerId,
        emailLower: row.email_lower,
        username: row.legacy_username,
        medusaCustomerId: row.medusa_customer_id,
        authIdentityId: row.medusa_auth_identity_id,
        customerExists: Boolean(row.customer_exists),
        hasAccount: Boolean(row.has_account),
        authCustomerId: row.auth_customer_id,
        providers: [],
      }

    if (row.provider_entity_id && row.password_hash) {
      account.providers.push({
        entityId: row.provider_entity_id,
        passwordHash: row.password_hash,
      })
    }

    accounts.set(legacyCustomerId, account)
  }

  return Array.from(accounts.values())
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await fn(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(concurrency, 1) }, () => worker())
  )
  return results
}

export default async function auditLegacyAuthPasswords({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const limit = getNumberArg(args, ["limit"], 0)
  const offset = getNumberArg(args, ["offset"], 0)
  const concurrency = Math.max(getNumberArg(args, ["concurrency"], 4), 1)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 25), 0)
  const envFile = getStringArg(args, ["env-file", "legacy-env-file"])

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
    throw new Error("Legacy DB env vars are required for credential audit")
  }

  const rows = await loadProviderRows(db, limit, offset)
  const accounts = groupAccounts(rows)
  const sourcePasswords = await loadSourcePasswords(
    accounts.map((account) => account.legacyCustomerId)
  )

  const samples: GapSample[] = []
  const stats = {
    loadedLegacyEnvFiles: loadedEnv.length,
    accountsSeen: accounts.length,
    sourcePasswordsFound: sourcePasswords.size,
    customersMissing: 0,
    customersWithoutAccount: 0,
    authCustomerMismatches: 0,
    providerPasswordMissing: 0,
    verifiedAnyProvider: 0,
    verifiedEmailProvider: 0,
    verifiedUsernameExactProvider: 0,
    verifiedUsernameLowerProvider: 0,
    sourcePasswordMismatch: 0,
    providerVerifyErrors: 0,
  }

  await mapWithConcurrency(accounts, concurrency, async (account, index) => {
    if ((index + 1) % 1000 === 0) {
      logger.info(
        `[legacy-auth-password-audit] verified ${index + 1}/${accounts.length}`
      )
    }

    const sourcePassword = sourcePasswords.get(account.legacyCustomerId)
    if (!sourcePassword) {
      return
    }

    if (!account.customerExists) {
      stats.customersMissing += 1
      addSample(samples, sampleLimit, {
        kind: "customer_missing",
        legacyCustomerId: account.legacyCustomerId,
      })
    }

    if (!account.hasAccount) {
      stats.customersWithoutAccount += 1
      addSample(samples, sampleLimit, {
        kind: "customer_without_account",
        legacyCustomerId: account.legacyCustomerId,
      })
    }

    if (
      account.authCustomerId &&
      account.medusaCustomerId &&
      account.authCustomerId !== account.medusaCustomerId
    ) {
      stats.authCustomerMismatches += 1
      addSample(samples, sampleLimit, {
        kind: "auth_customer_mismatch",
        legacyCustomerId: account.legacyCustomerId,
      })
    }

    if (!account.providers.length) {
      stats.providerPasswordMissing += 1
      addSample(samples, sampleLimit, {
        kind: "provider_password_missing",
        legacyCustomerId: account.legacyCustomerId,
      })
      return
    }

    let verifiedAny = false
    let verifiedEmail = false
    let verifiedUsernameExact = false
    let verifiedUsernameLower = false

    for (const provider of account.providers) {
      let verified = false
      try {
        verified = await verifyEmailpassPasswordHash(
          provider.passwordHash,
          sourcePassword
        )
      } catch {
        stats.providerVerifyErrors += 1
      }

      if (!verified) {
        continue
      }

      verifiedAny = true
      const type = providerType(account, provider.entityId)
      if (type === "email") {
        verifiedEmail = true
      } else if (type === "username_exact") {
        verifiedUsernameExact = true
      } else if (type === "username_lower") {
        verifiedUsernameLower = true
      }
    }

    if (verifiedAny) {
      stats.verifiedAnyProvider += 1
    } else {
      stats.sourcePasswordMismatch += 1
      addSample(samples, sampleLimit, {
        kind: "source_password_mismatch",
        legacyCustomerId: account.legacyCustomerId,
        detail: "No provider password hash verifies the legacy source password.",
      })
    }

    if (verifiedEmail) {
      stats.verifiedEmailProvider += 1
    }
    if (verifiedUsernameExact) {
      stats.verifiedUsernameExactProvider += 1
    }
    if (verifiedUsernameLower) {
      stats.verifiedUsernameLowerProvider += 1
    }
  })

  const hardGaps =
    stats.customersMissing +
    stats.customersWithoutAccount +
    stats.authCustomerMismatches +
    stats.providerPasswordMissing +
    stats.sourcePasswordMismatch +
    stats.providerVerifyErrors

  const report = {
    ...stats,
    hardGaps,
    samples,
  }

  logger.info(`[legacy-auth-password-audit] ${JSON.stringify(report)}`)
  console.log(JSON.stringify(report, null, 2))

  if (hardGaps > 0) {
    throw new Error(`Legacy auth password audit failed: hardGaps=${hardGaps}`)
  }
}
