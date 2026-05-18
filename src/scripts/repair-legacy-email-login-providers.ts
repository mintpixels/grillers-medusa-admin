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

type MissingEmailProviderRow = {
  legacy_customer_id: string
  email_lower: string
  medusa_customer_id: string
  medusa_auth_identity_id: string
}

type SourcePasswordRow = {
  ID: string | number
  PASSWORD: string | null
}

type ProviderPasswordRow = {
  id: string
  auth_identity_id: string
  entity_id: string
  password_hash: string | null
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

async function loadMissingEmailProviderRows(db: any) {
  const result = await db.raw(
    `
      select
        m.legacy_customer_id,
        m.email_lower,
        m.medusa_customer_id,
        m.medusa_auth_identity_id
      from legacy_customer_map m
      join customer c
        on c.id = m.medusa_customer_id
       and c.deleted_at is null
       and coalesce(c.has_account, false) = true
      join auth_identity ai
        on ai.id = m.medusa_auth_identity_id
       and ai.deleted_at is null
       and ai.app_metadata->>'customer_id' = m.medusa_customer_id
      where m.deleted_at is null
        and m.email_lower is not null
        and m.medusa_auth_identity_id is not null
        and coalesce(m.auth_import_status, '') <> 'no_password'
        and not exists (
          select 1
          from provider_identity pi
          where pi.provider = ?
            and pi.auth_identity_id = m.medusa_auth_identity_id
            and pi.entity_id = m.email_lower
            and pi.deleted_at is null
            and pi.provider_metadata->>'password' is not null
        )
      order by m.legacy_customer_id::numeric nulls last, m.legacy_customer_id
    `,
    [AUTH_PROVIDER]
  )

  return (result.rows ?? result) as MissingEmailProviderRow[]
}

async function loadAuthProviderRows(db: any, authIdentityId: string) {
  const rows = await db("provider_identity")
    .select([
      "id",
      "auth_identity_id",
      "entity_id",
      db.raw("provider_metadata->>'password' as password_hash"),
    ])
    .where("provider", AUTH_PROVIDER)
    .where("auth_identity_id", authIdentityId)
    .whereNull("deleted_at")

  return rows as ProviderPasswordRow[]
}

async function findEmailProviderRows(db: any, emailLower: string) {
  const rows = await db("provider_identity")
    .select(["id", "auth_identity_id", "entity_id"])
    .where("provider", AUTH_PROVIDER)
    .where("entity_id", emailLower)
    .whereNull("deleted_at")

  return rows as ProviderPasswordRow[]
}

async function findVerifiedProviderHash(
  providers: ProviderPasswordRow[],
  sourcePassword: string
) {
  for (const provider of providers) {
    if (!provider.password_hash) {
      continue
    }

    try {
      if (
        await verifyEmailpassPasswordHash(provider.password_hash, sourcePassword)
      ) {
        return provider.password_hash
      }
    } catch {
      continue
    }
  }

  return null
}

export default async function repairLegacyEmailLoginProviders({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const strict = getBooleanArg(args, ["strict"], false)
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
    throw new Error("Legacy DB env vars are required for email provider repair")
  }

  const rows = await loadMissingEmailProviderRows(db)
  const sourcePasswords = await loadSourcePasswords(
    rows.map((row) => row.legacy_customer_id)
  )

  const stats = {
    apply,
    strict,
    loadedLegacyEnvFiles: loadedEnv.length,
    missingEmailProviderRows: rows.length,
    sourcePasswordsFound: sourcePasswords.size,
    wouldInsert: 0,
    inserted: 0,
    wouldUpdate: 0,
    updated: 0,
    generatedFreshHash: 0,
    missingSourcePassword: 0,
    providerConflicts: 0,
    samples: [] as Array<{
      legacyCustomerId: string
      action: "insert" | "update"
    }>,
  }

  for (const row of rows) {
    const sourcePassword = sourcePasswords.get(row.legacy_customer_id)
    if (!sourcePassword) {
      stats.missingSourcePassword += 1
      continue
    }

    const existingEmailProviders = await findEmailProviderRows(
      db,
      row.email_lower
    )
    const conflictingEmailProvider = existingEmailProviders.find(
      (provider) => provider.auth_identity_id !== row.medusa_auth_identity_id
    )

    if (conflictingEmailProvider) {
      stats.providerConflicts += 1
      continue
    }

    const sameAuthEmailProvider = existingEmailProviders.find(
      (provider) => provider.auth_identity_id === row.medusa_auth_identity_id
    )
    const authProviders = await loadAuthProviderRows(
      db,
      row.medusa_auth_identity_id
    )
    let passwordHash = await findVerifiedProviderHash(
      authProviders,
      sourcePassword
    )

    if (!passwordHash) {
      passwordHash = await hashEmailpassPassword(sourcePassword)
      stats.generatedFreshHash += 1
    }

    const now = new Date()
    const metadata = {
      legacy_import: true,
      legacy_customer_id: row.legacy_customer_id,
      legacy_email_provider_repaired: true,
      legacy_email_provider_repaired_at: now.toISOString(),
    }

    if (sameAuthEmailProvider) {
      if (apply) {
        await db("provider_identity")
          .where("id", sameAuthEmailProvider.id)
          .update({
            provider_metadata: db.raw(
              "coalesce(provider_metadata, '{}'::jsonb) || ?::jsonb",
              [JSON.stringify({ password: passwordHash })]
            ),
            user_metadata: db.raw(
              "coalesce(user_metadata, '{}'::jsonb) || ?::jsonb",
              [JSON.stringify(metadata)]
            ),
            updated_at: now,
          })
        stats.updated += 1
      } else {
        stats.wouldUpdate += 1
      }

      if (stats.samples.length < sampleLimit) {
        stats.samples.push({
          legacyCustomerId: row.legacy_customer_id,
          action: "update",
        })
      }
      continue
    }

    if (apply) {
      await db("provider_identity").insert({
        id: generateEntityId(),
        entity_id: row.email_lower,
        provider: AUTH_PROVIDER,
        auth_identity_id: row.medusa_auth_identity_id,
        provider_metadata: { password: passwordHash },
        user_metadata: metadata,
        created_at: now,
        updated_at: now,
      })
      stats.inserted += 1
    } else {
      stats.wouldInsert += 1
    }

    if (stats.samples.length < sampleLimit) {
      stats.samples.push({
        legacyCustomerId: row.legacy_customer_id,
        action: "insert",
      })
    }
  }

  logger.info(`[legacy-email-provider-repair] ${JSON.stringify(stats)}`)
  console.log(JSON.stringify(stats, null, 2))

  if (strict && (stats.missingSourcePassword || stats.providerConflicts)) {
    throw new Error("Legacy email provider repair left unresolved conflicts")
  }
}
