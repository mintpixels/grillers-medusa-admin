import { selectVerifiedPasswordAuthIdentity } from "../customer-password-update"

describe("customer password update", () => {
  it("selects the one auth identity whose current password verifies", async () => {
    const result = await selectVerifiedPasswordAuthIdentity(
      [
        { auth_identity_id: "auth_1", password_hash: "hash-a" },
        { auth_identity_id: "auth_2", password_hash: "hash-b" },
      ],
      "current-password",
      async (hash) => hash === "hash-b"
    )

    expect(result).toEqual({
      status: "verified",
      authIdentityId: "auth_2",
    })
  })

  it("refuses ambiguous password matches across auth identities", async () => {
    const result = await selectVerifiedPasswordAuthIdentity(
      [
        { auth_identity_id: "auth_1", password_hash: "hash-a" },
        { auth_identity_id: "auth_2", password_hash: "hash-b" },
      ],
      "shared-password",
      async () => true
    )

    expect(result).toEqual({
      status: "ambiguous",
      authIdentityId: null,
    })
  })

  it("returns no_match when no provider hash verifies", async () => {
    const result = await selectVerifiedPasswordAuthIdentity(
      [
        { auth_identity_id: "auth_1", password_hash: "hash-a" },
        { auth_identity_id: "auth_2", password_hash: null },
      ],
      "wrong-password",
      async () => false
    )

    expect(result).toEqual({
      status: "no_match",
      authIdentityId: null,
    })
  })
})

