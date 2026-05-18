import mysql from "mysql2/promise"
import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateEntityId,
} from "@medusajs/framework/utils"
import {
  hashEmailpassPassword,
  verifyEmailpassPasswordHash,
} from "../lib/emailpass-password"
import {
  envVarsAreSet,
  getBooleanArg,
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
  auth_customer_id: string | null
  provider_entity_id: string | null
  password_hash: string | null
}

type SourcePasswordRow = {
  ID: string | number
  PASSWORD: string | null
}

type Account = {
  legacyCustomerId: string
  emailLower: string | null
  username: string | null
  medusaCustomerId: string | null
  authIdentityId: string | null
  authCustomerId: string | null
  providers: Array<{ entityId: string; passwordHash: string }>
}

type ExistingFallbackProvider = {
  id: string
  entityId: string
  authIdentityId: string
}

type FallbackWrite = {
  existingId: string | null
  entityId: string
  authIdentityId: string
  legacyCustomerId: string
  passwordHash: string
}

type AuthCustomerFix = {
  authIdentityId: string
  medusaCustomerId: string
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

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text || null
}

function legacyFallbackEntityId(legacyCustomerId: string) {
  return `legacy-password:${legacyCustomerId}`
}

async function loadSourcePasswords(legacyCustomerIds: string[]) {
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

async function loadProviderRows(db: any) {
  const rows = await db.raw(
    `
      select
        m.legacy_customer_id,
        m.email_lower,
        m.legacy_username,
        m.medusa_customer_id,
        m.medusa_auth_identity_id,
        ai.app_metadata->>'customer_id' as auth_customer_id,
        pi.entity_id as provider_entity_id,
        pi.provider_metadata->>'password' as password_hash
      from legacy_customer_map m
      left join auth_identity ai
        on ai.id = m.medusa_auth_identity_id
       and ai.deleted_at is null
      left join provider_identity pi
        on pi.auth_identity_id = m.medusa_auth_identity_id
       and pi.provider = ?
       and pi.deleted_at is null
       and pi.provider_metadata->>'password' is not null
      where m.deleted_at is null
        and m.medusa_customer_id is not null
        and m.medusa_auth_identity_id is not null
        and coalesce(m.auth_import_status, '') <> 'no_password'
      order by m.legacy_customer_id::numeric nulls last, m.legacy_customer_id
    `,
    [AUTH_PROVIDER]
  )

  return (rows.rows ?? rows) as ProviderPasswordRow[]
}

function groupAccounts(rows: ProviderPasswordRow[]) {
  const accounts = new Map<string, Account>()

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

async function loadAuthIdentityCustomerUseCounts(
  db: any
): Promise<Map<string, number>> {
  const rows = await db("legacy_customer_map")
    .select("medusa_auth_identity_id")
    .countDistinct({ customer_count: "medusa_customer_id" })
    .whereNull("deleted_at")
    .whereNotNull("medusa_auth_identity_id")
    .whereNotNull("medusa_customer_id")
    .groupBy("medusa_auth_identity_id")

  return new Map(
    rows.map((row: any) => [
      String(row.medusa_auth_identity_id),
      Number(row.customer_count || 0),
    ])
  )
}

async function loadExistingFallbackProviders(
  db: any
): Promise<Map<string, ExistingFallbackProvider>> {
  const rows = await db("provider_identity")
    .select(["id", "entity_id", "auth_identity_id"])
    .where("provider", AUTH_PROVIDER)
    .whereLike("entity_id", "legacy-password:%")
    .whereNull("deleted_at")

  return new Map(
    rows.map((row: any) => [
      String(row.entity_id),
      {
        id: String(row.id),
        entityId: String(row.entity_id),
        authIdentityId: String(row.auth_identity_id),
      },
    ])
  )
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
) {
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await fn(items[index], index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(concurrency, 1) }, () => worker())
  )
}

async function providerHashVerifies(account: Account, sourcePassword: string) {
  for (const provider of account.providers) {
    try {
      if (
        await verifyEmailpassPasswordHash(provider.passwordHash, sourcePassword)
      ) {
        return true
      }
    } catch {
      // Counted by the follow-up audit; a bad hash should not block another
      // valid provider hash from covering the account.
    }
  }

  return false
}

function planLegacyFallbackProvider({
  account,
  apply,
  existingFallbacks,
  passwordHash,
}: {
  account: Account
  apply: boolean
  existingFallbacks: Map<string, ExistingFallbackProvider>
  passwordHash: string
}) {
  const entityId = legacyFallbackEntityId(account.legacyCustomerId)
  const existing = existingFallbacks.get(entityId)

  if (existing && existing.authIdentityId !== account.authIdentityId) {
    return { result: "conflict" as const, action: null }
  }

  if (!apply) {
    return {
      result: existing ? ("would_update" as const) : ("would_insert" as const),
      action: null,
    }
  }

  return {
    result: existing ? ("updated" as const) : ("inserted" as const),
    action: {
      existingId: existing?.id ?? null,
      entityId,
      authIdentityId: account.authIdentityId || "",
      legacyCustomerId: account.legacyCustomerId,
      passwordHash,
    },
  }
}

async function applyBackfillWrites({
  authFixes,
  fallbackWrites,
}: {
  authFixes: AuthCustomerFix[]
  fallbackWrites: FallbackWrite[]
}) {
  const { Client } = (await import("pg")) as any
  const client = new Client({ connectionString: requiredEnv("DATABASE_URL") })
  await client.connect()

  try {
    for (const fix of authFixes) {
      await client.query(
        `
          update auth_identity
             set app_metadata = coalesce(app_metadata, '{}'::jsonb) || $1::jsonb,
                 updated_at = $2
           where id = $3
        `,
        [
          JSON.stringify({ customer_id: fix.medusaCustomerId }),
          new Date(),
          fix.authIdentityId,
        ]
      )
    }

    for (const write of fallbackWrites) {
      const now = new Date()
      const userMetadata = {
        legacy_import: true,
        legacy_password_fallback: true,
        legacy_customer_id: write.legacyCustomerId,
        legacy_fallback_imported_at: now.toISOString(),
      }

      if (write.existingId) {
        await client.query(
          `
            update provider_identity
               set provider_metadata = coalesce(provider_metadata, '{}'::jsonb) || $1::jsonb,
                   user_metadata = coalesce(user_metadata, '{}'::jsonb) || $2::jsonb,
                   updated_at = $3
             where id = $4
          `,
          [
            JSON.stringify({ password: write.passwordHash }),
            JSON.stringify(userMetadata),
            now,
            write.existingId,
          ]
        )
        continue
      }

      await client.query(
        `
          insert into provider_identity (
            id,
            entity_id,
            provider,
            auth_identity_id,
            provider_metadata,
            user_metadata,
            created_at,
            updated_at
          ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
        `,
        [
          generateEntityId(),
          write.entityId,
          AUTH_PROVIDER,
          write.authIdentityId,
          JSON.stringify({ password: write.passwordHash }),
          JSON.stringify(userMetadata),
          now,
          now,
        ]
      )
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

export default async function backfillLegacyAuthPasswordFallbacks({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const concurrency = Math.max(getNumberArg(args, ["concurrency"], 4), 1)
  const envFile = getStringArg(args, ["env-file", "legacy-env-file"])

  loadEnvFilesUntil(
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
    throw new Error("Legacy DB env vars are required for fallback backfill")
  }

  const accounts = groupAccounts(await loadProviderRows(db))
  const sourcePasswords = await loadSourcePasswords(
    accounts.map((account) => account.legacyCustomerId)
  )
  const authUseCounts = await loadAuthIdentityCustomerUseCounts(db)
  const existingFallbacks = await loadExistingFallbackProviders(db)
  const authFixes: AuthCustomerFix[] = []
  const fallbackWrites: FallbackWrite[] = []

  const stats = {
    apply,
    accountsSeen: accounts.length,
    sourcePasswordsFound: sourcePasswords.size,
    alreadyCovered: 0,
    missingSourcePassword: 0,
    missingAuthIdentity: 0,
    passwordFallbackNeeded: 0,
    fallbackWouldInsert: 0,
    fallbackInserted: 0,
    fallbackWouldUpdate: 0,
    fallbackUpdated: 0,
    fallbackConflicts: 0,
    authCustomerMismatchFound: 0,
    authCustomerMismatchWouldFix: 0,
    authCustomerMismatchFixed: 0,
    authCustomerMismatchSkippedSharedAuth: 0,
  }

  await mapWithConcurrency(accounts, concurrency, async (account, index) => {
    if ((index + 1) % 1000 === 0) {
      logger.info(
        `[legacy-auth-fallback-backfill] scanned ${index + 1}/${accounts.length}`
      )
    }

    const sourcePassword = sourcePasswords.get(account.legacyCustomerId)
    if (!sourcePassword) {
      stats.missingSourcePassword += 1
      return
    }

    if (!account.authIdentityId) {
      stats.missingAuthIdentity += 1
      return
    }

    if (
      account.authCustomerId &&
      account.medusaCustomerId &&
      account.authCustomerId !== account.medusaCustomerId
    ) {
      stats.authCustomerMismatchFound += 1
      const authUseCount = authUseCounts.get(account.authIdentityId) ?? 0

      if (authUseCount > 1) {
        stats.authCustomerMismatchSkippedSharedAuth += 1
      } else if (!apply) {
        stats.authCustomerMismatchWouldFix += 1
      } else {
        authFixes.push({
          authIdentityId: account.authIdentityId,
          medusaCustomerId: account.medusaCustomerId,
        })
        stats.authCustomerMismatchFixed += 1
      }
    }

    if (await providerHashVerifies(account, sourcePassword)) {
      stats.alreadyCovered += 1
      return
    }

    stats.passwordFallbackNeeded += 1
    const passwordHash = await hashEmailpassPassword(sourcePassword)
    const { action, result } = planLegacyFallbackProvider({
      account,
      apply,
      existingFallbacks,
      passwordHash,
    })
    if (action) {
      fallbackWrites.push(action)
      existingFallbacks.set(action.entityId, {
        id: action.existingId || "__pending_insert__",
        entityId: action.entityId,
        authIdentityId: action.authIdentityId,
      })
    }

    if (result === "would_insert") stats.fallbackWouldInsert += 1
    else if (result === "inserted") stats.fallbackInserted += 1
    else if (result === "would_update") stats.fallbackWouldUpdate += 1
    else if (result === "updated") stats.fallbackUpdated += 1
    else stats.fallbackConflicts += 1
  })

  if (apply && (authFixes.length || fallbackWrites.length)) {
    await applyBackfillWrites({ authFixes, fallbackWrites })
  }

  logger.info(`[legacy-auth-fallback-backfill] ${JSON.stringify(stats)}`)
  console.log(JSON.stringify(stats, null, 2))

  if (stats.fallbackConflicts || stats.authCustomerMismatchSkippedSharedAuth) {
    throw new Error("Legacy auth fallback backfill left unresolved conflicts")
  }
}
