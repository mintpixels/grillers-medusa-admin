import {
  hashEmailpassPassword,
  verifyEmailpassPasswordHash,
} from "./emailpass-password"

export type ProviderPasswordRow = {
  auth_identity_id: string | null
  password_hash?: string | null
}

type VerifyPassword = (passwordHash: string, password: string) => Promise<boolean>

export async function selectVerifiedPasswordAuthIdentity(
  rows: ProviderPasswordRow[],
  password: string,
  verifyPassword: VerifyPassword = verifyEmailpassPasswordHash
) {
  const matches = new Set<string>()

  for (const row of rows) {
    if (!row.auth_identity_id || !row.password_hash) {
      continue
    }

    let verified = false
    try {
      verified = await verifyPassword(row.password_hash, password)
    } catch {
      verified = false
    }

    if (verified) {
      matches.add(row.auth_identity_id)
    }
  }

  if (matches.size === 1) {
    return {
      status: "verified" as const,
      authIdentityId: Array.from(matches)[0],
    }
  }

  return {
    status: matches.size > 1 ? ("ambiguous" as const) : ("no_match" as const),
    authIdentityId: null,
  }
}

export async function updateCustomerEmailpassPassword({
  currentPassword,
  customerId,
  db,
  newPassword,
  sessionAuthIdentityId,
}: {
  currentPassword: string
  customerId: string
  db: any
  newPassword: string
  sessionAuthIdentityId?: string | null
}) {
  const authIdentityRows = await db("auth_identity")
    .select("id")
    .whereNull("deleted_at")
    .andWhere((builder: any) => {
      builder.whereRaw("app_metadata->>'customer_id' = ?", [customerId])
      if (sessionAuthIdentityId) {
        builder.orWhere("id", sessionAuthIdentityId)
      }
    })

  const authIdentityIds = Array.from(
    new Set(
      authIdentityRows
        .map((row: any) => String(row.id ?? "").trim())
        .filter(Boolean)
    )
  )

  if (!authIdentityIds.length) {
    return { status: "no_auth_identity" as const }
  }

  const passwordRows = (await db("provider_identity")
    .select([
      "auth_identity_id",
      db.raw("provider_metadata->>'password' as password_hash"),
    ])
    .where("provider", "emailpass")
    .whereIn("auth_identity_id", authIdentityIds)
    .whereNull("deleted_at")
    .whereRaw("provider_metadata->>'password' is not null")) as
    ProviderPasswordRow[]

  const verified = await selectVerifiedPasswordAuthIdentity(
    passwordRows,
    currentPassword
  )

  if (verified.status !== "verified") {
    return { status: verified.status }
  }

  const passwordHash = await hashEmailpassPassword(newPassword)
  const now = new Date()

  await db("provider_identity")
    .where("provider", "emailpass")
    .where("auth_identity_id", verified.authIdentityId)
    .whereNull("deleted_at")
    .update({
      provider_metadata: db.raw("coalesce(provider_metadata, '{}'::jsonb) || ?::jsonb", [
        JSON.stringify({ password: passwordHash }),
      ]),
      user_metadata: db.raw("coalesce(user_metadata, '{}'::jsonb) || ?::jsonb", [
        JSON.stringify({
          customer_password_updated_at: now.toISOString(),
          customer_password_update_source: "storefront_account",
        }),
      ]),
      updated_at: now,
    })

  return {
    status: "updated" as const,
    authIdentityId: verified.authIdentityId,
  }
}

