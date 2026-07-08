import { importConstantContactRows } from "../communications/imports"

jest.mock("../communications/core", () => ({
  upsertCustomerProfile: jest.fn(async (_db: any, input: any) => ({
    id: "gpcprof_x",
    ...input,
  })),
  recordSuppression: jest.fn(async () => undefined),
  recordCommunicationEvent: jest.fn(async () => ({})),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true })),
}))

const core = jest.requireMock("../communications/core")

function fakeDb() {
  const writes: Array<{ table: string; op: string; data: any }> = []
  const db: any = (table: string) => {
    const chain: any = {}
    chain.insert = (data: any) => {
      writes.push({ table, op: "insert", data })
      return Promise.resolve([])
    }
    chain.where = () => chain
    chain.update = (data: any) => {
      writes.push({ table, op: "update", data })
      return Promise.resolve([])
    }
    return chain
  }
  return { db, writes }
}

describe("importConstantContactRows consent semantics", () => {
  beforeEach(() => jest.clearAllMocks())

  it("Active grants consent; Unsubscribed suppresses; empty status imports WITHOUT consent or suppression", async () => {
    const { db } = fakeDb()
    const rows = [
      { "email address": "active@x.com", status: "Active" },
      { "email address": "unsub@x.com", status: "Unsubscribed" },
      { "email address": "nostatus@x.com", status: "" },
      { "email address": "awaiting@x.com", status: "Awaiting confirmation" },
      { "email address": "noperm@x.com", status: "No Permissions Set" },
      { "email address": "confirmed@x.com", status: "Confirmed" },
    ]

    const result = await importConstantContactRows(db, rows)

    expect(result.stats).toMatchObject({
      total: 6,
      subscribed: 2, // Active + Confirmed
      unsubscribed: 1,
      no_consent: 3, // empty, awaiting, no-permissions
      imported: 6,
      failed: 0,
    })

    const upserts = (core.upsertCustomerProfile as jest.Mock).mock.calls.map(
      (c: any[]) => c[1]
    )
    const byEmail = Object.fromEntries(upserts.map((u: any) => [u.email, u]))
    expect(byEmail["active@x.com"].email_consent).toBe(true)
    expect(byEmail["confirmed@x.com"].email_consent).toBe(true)
    expect(byEmail["unsub@x.com"].email_consent).toBe(false)
    // No positive evidence → undefined, so an existing profile's stronger
    // opt-in (site signup) is never downgraded by the import.
    expect(byEmail["nostatus@x.com"].email_consent).toBeUndefined()
    expect(byEmail["nostatus@x.com"].preferences).toBeUndefined()
    expect(byEmail["awaiting@x.com"].email_consent).toBeUndefined()
    expect(byEmail["noperm@x.com"].email_consent).toBeUndefined()

    // Only the unsubscribe generates a suppression.
    expect(core.recordSuppression).toHaveBeenCalledTimes(1)
    expect((core.recordSuppression as jest.Mock).mock.calls[0][1]).toMatchObject({
      email: "unsub@x.com",
      reason: "constant_contact_unsubscribe",
    })
  })

  it("records permission level in profile metadata", async () => {
    const { db } = fakeDb()
    await importConstantContactRows(db, [
      {
        "email address": "imp@x.com",
        status: "Active",
        permission: "Implied",
        lists: "2023-02-18-All",
      },
    ])
    const input = (core.upsertCustomerProfile as jest.Mock).mock.calls[0][1]
    expect(input.metadata.constant_contact_permission).toBe("Implied")
    expect(input.metadata.constant_contact_lists).toBe("2023-02-18-All")
  })
})
