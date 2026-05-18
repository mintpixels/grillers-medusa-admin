import {
  legacyLoginSearchTerms,
  legacyLoginCandidatesFromProviderRows,
  selectUniqueVerifiedLegacyLoginCandidate,
} from "../legacy-customer-auth"

describe("legacy customer auth fallback", () => {
  it("searches legacy email addresses only for email-shaped identifiers", () => {
    expect(legacyLoginSearchTerms(" Customer@Example.COM ")).toEqual({
      normalized: "Customer@Example.COM",
      usernameLower: "customer@example.com",
      emailLower: "customer@example.com",
    })

    expect(legacyLoginSearchTerms("LegacyUser")).toEqual({
      normalized: "LegacyUser",
      usernameLower: "legacyuser",
      emailLower: null,
    })
  })

  it("prefers the canonical email provider hash for a legacy username", async () => {
    const candidates = legacyLoginCandidatesFromProviderRows([
      {
        legacy_customer_id: "100",
        medusa_customer_id: "cus_100",
        medusa_auth_identity_id: "auth_100",
        auth_customer_id: "cus_100",
        provider_entity_id: "legacyuser",
        password_hash: "stale-alias-hash",
        is_canonical_provider: false,
      },
      {
        legacy_customer_id: "100",
        medusa_customer_id: "cus_100",
        medusa_auth_identity_id: "auth_100",
        auth_customer_id: "cus_100",
        provider_entity_id: "customer@example.com",
        password_hash: "current-email-hash",
        is_canonical_provider: true,
      },
    ])

    expect(candidates).toEqual([
      {
        legacyCustomerId: "100",
        customerId: "cus_100",
        authIdentityId: "auth_100",
        passwordHash: "current-email-hash",
        passwordHashes: ["current-email-hash", "stale-alias-hash"],
        identifierMatchPriority: 0,
      },
    ])
  })

  it("accepts a legacy fallback hash when the canonical provider has a newer password", async () => {
    const match = await selectUniqueVerifiedLegacyLoginCandidate(
      [
        {
          legacyCustomerId: "100",
          customerId: "cus_100",
          authIdentityId: "auth_100",
          passwordHash: "current-email-hash",
          passwordHashes: ["current-email-hash", "legacy-fallback-hash"],
        },
      ],
      "legacy-secret",
      async (hash) => hash === "legacy-fallback-hash"
    )

    expect(match).toEqual({
      customerId: "cus_100",
      authIdentityId: "auth_100",
    })
  })

  it("issues a fallback login only when exactly one legacy account password verifies", async () => {
    const match = await selectUniqueVerifiedLegacyLoginCandidate(
      [
        {
          legacyCustomerId: "100",
          customerId: "cus_100",
          authIdentityId: "auth_100",
          passwordHash: "hash-a",
        },
        {
          legacyCustomerId: "200",
          customerId: "cus_200",
          authIdentityId: "auth_200",
          passwordHash: "hash-b",
        },
      ],
      "secret",
      async (hash) => hash === "hash-a"
    )

    expect(match).toEqual({
      customerId: "cus_100",
      authIdentityId: "auth_100",
    })
  })

  it("refuses ambiguous legacy username matches", async () => {
    const match = await selectUniqueVerifiedLegacyLoginCandidate(
      [
        {
          legacyCustomerId: "100",
          customerId: "cus_100",
          authIdentityId: "auth_100",
          passwordHash: "hash-a",
        },
        {
          legacyCustomerId: "200",
          customerId: "cus_200",
          authIdentityId: "auth_200",
          passwordHash: "hash-b",
        },
      ],
      "shared-secret",
      async () => true
    )

    expect(match).toBeNull()
  })

  it("prefers a canonical email identifier match over a username alias match", async () => {
    const match = await selectUniqueVerifiedLegacyLoginCandidate(
      [
        {
          legacyCustomerId: "100",
          customerId: "cus_email",
          authIdentityId: "auth_email",
          passwordHash: "shared-hash",
          identifierMatchPriority: 0,
        },
        {
          legacyCustomerId: "200",
          customerId: "cus_username",
          authIdentityId: "auth_username",
          passwordHash: "shared-hash",
          identifierMatchPriority: 1,
        },
      ],
      "secret",
      async () => true
    )

    expect(match).toEqual({
      customerId: "cus_email",
      authIdentityId: "auth_email",
    })
  })

  it("skips provider identities whose auth metadata points at a different customer", () => {
    const candidates = legacyLoginCandidatesFromProviderRows([
      {
        legacy_customer_id: "100",
        medusa_customer_id: "cus_100",
        medusa_auth_identity_id: "auth_100",
        auth_customer_id: "cus_someone_else",
        password_hash: "hash-a",
        is_canonical_provider: true,
      },
    ])

    expect(candidates).toEqual([])
  })
})
