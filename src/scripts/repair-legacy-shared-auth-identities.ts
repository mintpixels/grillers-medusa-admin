import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  generateEntityId,
} from "@medusajs/framework/utils"
import {
  getBooleanArg,
  getNumberArg,
  parseArgs,
} from "./lib/legacy-import-utils"

type SharedAuthMapRow = {
  legacy_customer_id: string
  email_lower: string | null
  legacy_username: string | null
  medusa_customer_id: string
  medusa_auth_identity_id: string
  auth_customer_id: string
}

type ProviderIdentityRow = {
  id: string
  entity_id: string
}

function normalizeText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text || null
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    )
  )
}

function legacyFallbackEntityId(legacyCustomerId: string) {
  return `legacy-password:${legacyCustomerId}`
}

function loginIdentifiers(row: SharedAuthMapRow) {
  const username = normalizeText(row.legacy_username)
  return uniqueStrings([
    row.email_lower,
    username,
    username?.toLowerCase(),
    legacyFallbackEntityId(row.legacy_customer_id),
  ])
}

function providerBelongsToLegacyMap(
  provider: ProviderIdentityRow,
  row: SharedAuthMapRow
) {
  const entityId = normalizeText(provider.entity_id)
  if (!entityId) {
    return false
  }

  const entityLower = entityId.toLowerCase()
  const emailLower = normalizeText(row.email_lower)?.toLowerCase()
  const username = normalizeText(row.legacy_username)
  const usernameLower = username?.toLowerCase()

  return Boolean(
    (emailLower && entityLower === emailLower) ||
      (username && entityId === username) ||
      (usernameLower && entityLower === usernameLower) ||
      entityId === legacyFallbackEntityId(row.legacy_customer_id)
  )
}

async function loadSharedAuthMismatches(db: any) {
  const result = await db.raw(`
    with shared_auth as (
      select medusa_auth_identity_id
      from legacy_customer_map
      where deleted_at is null
        and medusa_auth_identity_id is not null
        and medusa_customer_id is not null
      group by medusa_auth_identity_id
      having count(distinct medusa_customer_id) > 1
    )
    select
      m.legacy_customer_id,
      m.email_lower,
      m.legacy_username,
      m.medusa_customer_id,
      m.medusa_auth_identity_id,
      ai.app_metadata->>'customer_id' as auth_customer_id
    from legacy_customer_map m
    join shared_auth s on s.medusa_auth_identity_id = m.medusa_auth_identity_id
    join auth_identity ai
      on ai.id = m.medusa_auth_identity_id
     and ai.deleted_at is null
    where m.deleted_at is null
      and m.medusa_customer_id is not null
      and ai.app_metadata->>'customer_id' is not null
      and ai.app_metadata->>'customer_id' <> m.medusa_customer_id
    order by m.legacy_customer_id::numeric nulls last, m.legacy_customer_id
  `)

  return (result.rows ?? result) as SharedAuthMapRow[]
}

export default async function repairLegacySharedAuthIdentities({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const sampleLimit = Math.max(getNumberArg(args, ["sample-limit"], 25), 0)

  const rows = await loadSharedAuthMismatches(db)
  const stats = {
    apply,
    sharedAuthMismatches: rows.length,
    wouldSplit: 0,
    split: 0,
    providerRowsWouldMove: 0,
    providerRowsMoved: 0,
    skippedNoProviderRows: 0,
    samples: [] as Array<{
      legacyCustomerId: string
      movedProviderCount: number
      oldAuthIdentityId: string
      newAuthIdentityId?: string
    }>,
  }

  for (const row of rows) {
    const candidateProviderRows = (await db("provider_identity")
      .select(["id", "entity_id"])
      .where("provider", "emailpass")
      .where("auth_identity_id", row.medusa_auth_identity_id)
      .whereNull("deleted_at")) as ProviderIdentityRow[]
    const providerRows = candidateProviderRows.filter((provider) =>
      providerBelongsToLegacyMap(provider, row)
    )

    if (!providerRows.length) {
      stats.skippedNoProviderRows += 1
      continue
    }

    if (!apply) {
      stats.wouldSplit += 1
      stats.providerRowsWouldMove += providerRows.length
      if (stats.samples.length < sampleLimit) {
        stats.samples.push({
          legacyCustomerId: row.legacy_customer_id,
          movedProviderCount: providerRows.length,
          oldAuthIdentityId: row.medusa_auth_identity_id,
        })
      }
      continue
    }

    const now = new Date()
    const newAuthIdentityId = generateEntityId(undefined, "authid")

    await db.transaction(async (trx: any) => {
      await trx("auth_identity").insert({
        id: newAuthIdentityId,
        app_metadata: { customer_id: row.medusa_customer_id },
        created_at: now,
        updated_at: now,
      })

      await trx("provider_identity")
        .whereIn(
          "id",
          providerRows.map((provider: any) => provider.id)
        )
        .update({
          auth_identity_id: newAuthIdentityId,
          user_metadata: trx.raw(
            "coalesce(user_metadata, '{}'::jsonb) || ?::jsonb",
            [
              JSON.stringify({
                legacy_auth_identity_split: true,
                legacy_auth_identity_split_from: row.medusa_auth_identity_id,
                legacy_auth_identity_split_at: now.toISOString(),
              }),
            ]
          ),
          updated_at: now,
        })

      await trx("legacy_customer_map")
        .where("legacy_customer_id", row.legacy_customer_id)
        .whereNull("deleted_at")
        .update({
          medusa_auth_identity_id: newAuthIdentityId,
          metadata: trx.raw("coalesce(metadata, '{}'::jsonb) || ?::jsonb", [
            JSON.stringify({
              auth_identity_split_from: row.medusa_auth_identity_id,
              auth_identity_split_at: now.toISOString(),
            }),
          ]),
          updated_at: now,
        })
    })

    stats.split += 1
    stats.providerRowsMoved += providerRows.length
    if (stats.samples.length < sampleLimit) {
      stats.samples.push({
        legacyCustomerId: row.legacy_customer_id,
        movedProviderCount: providerRows.length,
        oldAuthIdentityId: row.medusa_auth_identity_id,
        newAuthIdentityId,
      })
    }
  }

  logger.info(`[legacy-shared-auth-repair] ${JSON.stringify(stats)}`)
  console.log(JSON.stringify(stats, null, 2))

  if (stats.skippedNoProviderRows) {
    throw new Error("Some shared auth mismatches had no provider rows to move")
  }
}
