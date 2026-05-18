import { generateJwtToken } from "@medusajs/framework/utils"
import { verifyEmailpassPasswordHash } from "./emailpass-password"

const AUTH_PROVIDER = "emailpass"

type VerifyPassword = (passwordHash: string, password: string) => Promise<boolean>

export type LegacyLoginProviderRow = {
  legacy_customer_id?: string | null
  medusa_customer_id?: string | null
  medusa_auth_identity_id?: string | null
  auth_customer_id?: string | null
  provider_entity_id?: string | null
  password_hash?: string | null
  is_canonical_provider?: boolean | string | number | null
}

export type LegacyLoginCandidate = {
  legacyCustomerId: string | null
  customerId: string
  authIdentityId: string
  passwordHash: string
}

export type VerifiedLegacyLogin = {
  customerId: string
  authIdentityId: string
}

function truthy(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1"
}

export function normalizeLegacyLoginIdentifier(value: unknown) {
  return String(value ?? "").trim()
}

export function legacyLoginSearchTerms(identifier: unknown) {
  const normalized = normalizeLegacyLoginIdentifier(identifier)
  const lower = normalized.toLowerCase()

  return {
    normalized,
    usernameLower: lower,
    emailLower: normalized.includes("@") ? lower : null,
  }
}

async function verifyScryptPassword(passwordHash: string, password: string) {
  return verifyEmailpassPasswordHash(passwordHash, password)
}

export function legacyLoginCandidatesFromProviderRows(
  rows: LegacyLoginProviderRow[]
): LegacyLoginCandidate[] {
  const byAccount = new Map<
    string,
    {
      legacyCustomerId: string | null
      customerId: string
      authIdentityId: string
      canonicalPasswordHash: string | null
      fallbackPasswordHash: string | null
    }
  >()

  for (const row of rows) {
    const customerId = normalizeLegacyLoginIdentifier(row.medusa_customer_id)
    const authIdentityId = normalizeLegacyLoginIdentifier(row.medusa_auth_identity_id)
    const authCustomerId = normalizeLegacyLoginIdentifier(row.auth_customer_id)
    const passwordHash =
      typeof row.password_hash === "string" && row.password_hash.length
        ? row.password_hash
        : null

    if (!customerId || !authIdentityId || !passwordHash) {
      continue
    }

    if (authCustomerId && authCustomerId !== customerId) {
      continue
    }

    const key = `${customerId}:${authIdentityId}`
    const existing =
      byAccount.get(key) ??
      {
        legacyCustomerId: row.legacy_customer_id ?? null,
        customerId,
        authIdentityId,
        canonicalPasswordHash: null,
        fallbackPasswordHash: null,
      }

    if (truthy(row.is_canonical_provider)) {
      existing.canonicalPasswordHash ??= passwordHash
    } else {
      existing.fallbackPasswordHash ??= passwordHash
    }

    byAccount.set(key, existing)
  }

  return Array.from(byAccount.values())
    .map((candidate) => ({
      legacyCustomerId: candidate.legacyCustomerId,
      customerId: candidate.customerId,
      authIdentityId: candidate.authIdentityId,
      passwordHash:
        candidate.canonicalPasswordHash ?? candidate.fallbackPasswordHash ?? "",
    }))
    .filter((candidate) => candidate.passwordHash)
}

export async function selectUniqueVerifiedLegacyLoginCandidate(
  candidates: LegacyLoginCandidate[],
  password: string,
  verifyPassword: VerifyPassword = verifyScryptPassword
): Promise<VerifiedLegacyLogin | null> {
  const matches: VerifiedLegacyLogin[] = []

  for (const candidate of candidates) {
    let passwordMatches = false
    try {
      passwordMatches = await verifyPassword(candidate.passwordHash, password)
    } catch {
      passwordMatches = false
    }

    if (!passwordMatches) {
      continue
    }

    matches.push({
      customerId: candidate.customerId,
      authIdentityId: candidate.authIdentityId,
    })
  }

  const uniqueMatches = new Map(
    matches.map((match) => [`${match.customerId}:${match.authIdentityId}`, match])
  )

  return uniqueMatches.size === 1 ? Array.from(uniqueMatches.values())[0] : null
}

export async function findLegacyLoginCandidates(db: any, identifier: string) {
  const search = legacyLoginSearchTerms(identifier)
  if (!search.normalized) {
    return []
  }

  const rows = (await db("legacy_customer_map as m")
    .join("customer as c", "c.id", "m.medusa_customer_id")
    .join("auth_identity as ai", "ai.id", "m.medusa_auth_identity_id")
    .join("provider_identity as pi", "pi.auth_identity_id", "m.medusa_auth_identity_id")
    .select([
      "m.legacy_customer_id",
      "m.medusa_customer_id",
      "m.medusa_auth_identity_id",
      "pi.entity_id as provider_entity_id",
      db.raw("ai.app_metadata->>'customer_id' as auth_customer_id"),
      db.raw("pi.provider_metadata->>'password' as password_hash"),
      db.raw(
        "case when m.email_lower is not null and lower(pi.entity_id) = m.email_lower then true else false end as is_canonical_provider"
      ),
    ])
    .whereNull("m.deleted_at")
    .whereNull("c.deleted_at")
    .whereNull("ai.deleted_at")
    .whereNull("pi.deleted_at")
    .where("pi.provider", AUTH_PROVIDER)
    .whereRaw("coalesce(c.has_account, false) = true")
    .whereRaw("pi.provider_metadata->>'password' is not null")
    .andWhere((builder: any) => {
      builder.whereRaw("lower(m.legacy_username) = ?", [search.usernameLower])

      if (search.emailLower) {
        builder.orWhere("m.email_lower", search.emailLower)
      }
    })) as
    LegacyLoginProviderRow[]

  return legacyLoginCandidatesFromProviderRows(rows)
}

export async function authenticateLegacyCustomerLogin({
  db,
  identifier,
  password,
}: {
  db: any
  identifier: string
  password: string
}) {
  const candidates = await findLegacyLoginCandidates(db, identifier)
  return selectUniqueVerifiedLegacyLoginCandidate(candidates, password)
}

export function generateLegacyCustomerAuthToken({
  authIdentityId,
  config,
  customerId,
}: {
  authIdentityId: string
  config: any
  customerId: string
}) {
  const http = config?.projectConfig?.http ?? {}

  return generateJwtToken(
    {
      actor_id: customerId,
      actor_type: "customer",
      auth_identity_id: authIdentityId,
      app_metadata: {
        customer_id: customerId,
      },
    },
    {
      secret: http.jwtSecret || process.env.JWT_SECRET || "supersecret",
      expiresIn: http.jwtExpiresIn ?? http.jwtOptions?.expiresIn,
      jwtOptions: http.jwtOptions,
    }
  )
}
