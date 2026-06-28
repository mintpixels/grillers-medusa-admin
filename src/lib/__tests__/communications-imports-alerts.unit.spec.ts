import { emitOpsAlert } from "../ops-alert"
import {
  recordCommunicationEvent,
  recordSuppression,
  upsertCustomerProfile,
} from "../communications/core"
import { importConstantContactRows } from "../communications/imports"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

jest.mock("../communications/core", () => ({
  recordCommunicationEvent: jest.fn(),
  recordSuppression: jest.fn(),
  upsertCustomerProfile: jest.fn(),
}))

function makeDb() {
  const state = {
    inserts: [] as Array<{ table: string; payload: unknown }>,
    updates: [] as Array<{ table: string; payload: unknown }>,
  }
  const chain: any = {
    where: jest.fn(() => chain),
    insert: jest.fn(async (payload: unknown) => {
      state.inserts.push({ table: chain.__table, payload })
    }),
    update: jest.fn(async (payload: unknown) => {
      state.updates.push({ table: chain.__table, payload })
    }),
  }
  const db = jest.fn((table: string) => {
    chain.__table = table
    return chain
  })
  return { db, state }
}

describe("Constant Contact import row-failure alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(recordCommunicationEvent as jest.Mock).mockResolvedValue({ id: "evt_1" })
    ;(recordSuppression as jest.Mock).mockResolvedValue(undefined)
    ;(upsertCustomerProfile as jest.Mock).mockResolvedValue({
      id: "gpcprof_1",
    })
  })

  it("emits one aggregate ops alert when imported rows fail", async () => {
    ;(upsertCustomerProfile as jest.Mock)
      .mockResolvedValueOnce({ id: "gpcprof_ok" })
      .mockRejectedValueOnce(new Error("bad row for shopper@example.com"))
    const { db } = makeDb()

    const result = await importConstantContactRows(
      db,
      [
        { email: "ok@example.com", status: "subscribed" },
        { email: "shopper@example.com", status: "subscribed" },
      ],
      { uploaded_by: "admin_1", filename: "contacts.csv" }
    )

    expect(result.status).toBe("completed_with_errors")
    expect(result.stats.failed).toBe(1)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "constant_contact_import_failed_rows",
        severity: "warn",
        fingerprint: "constant_contact_import:failed_rows",
        meta: expect.objectContaining({
          import_run_id: result.import_run_id,
          total_count: 2,
          imported_count: 1,
          skipped_count: 0,
          failed_count: 1,
          has_uploaded_by: true,
          has_filename: true,
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("shopper@example.com")
  })

  it("does not alert when rows are only skipped for missing email", async () => {
    const { db } = makeDb()

    const result = await importConstantContactRows(db, [{ name: "No Email" }])

    expect(result.status).toBe("completed")
    expect(result.stats.skipped).toBe(1)
    expect(result.stats.failed).toBe(0)
    expect(emitOpsAlert).not.toHaveBeenCalled()
  })
})
