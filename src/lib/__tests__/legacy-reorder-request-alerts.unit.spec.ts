import { submitLegacyReorderRequest } from "../legacy-reorder-request"
import { listLegacyPurchaseHistoryForCustomer } from "../legacy-order-history"
import { emitOpsAlert } from "../ops-alert"

jest.mock("../legacy-order-history", () => ({
  listLegacyPurchaseHistoryForCustomer: jest.fn(),
  normalizeEmail: (value: unknown) => String(value || "").trim().toLowerCase(),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

function makeBuilder(firstResult?: unknown) {
  const builder: any = {
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    first: jest.fn(async () => firstResult),
    insert: jest.fn(async () => undefined),
    update: jest.fn(async () => undefined),
  }
  return builder
}

describe("legacy reorder request ops alerts", () => {
  beforeEach(() => {
    ;(listLegacyPurchaseHistoryForCustomer as jest.Mock).mockReset()
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  it("emits a page alert when the staff notification fails after request creation", async () => {
    ;(listLegacyPurchaseHistoryForCustomer as jest.Mock).mockResolvedValue([
      {
        key: "legacy:item",
        legacyItemId: "80000123",
        sku: "10-20",
        title: "Past purchase",
        productTitle: "Past purchase",
        reorderable: false,
        mappingStatus: "needs_mapping",
      },
    ])

    const builders: any[] = []
    const db: any = jest.fn((table: string) => {
      const builder =
        table === "customer"
          ? makeBuilder({
              id: "cus_legacy",
              email: "customer@example.com",
              first_name: "Pat",
              last_name: "Customer",
            })
          : makeBuilder(undefined)
      builders.push({ table, builder })
      return builder
    })

    const notificationModule = {
      createNotifications: jest.fn(async () => {
        throw new Error("postmark unavailable")
      }),
    }
    const logger = { error: jest.fn() }

    const result = await submitLegacyReorderRequest({
      db,
      notificationModule,
      logger,
      customerId: "cus_legacy",
      key: "legacy:item",
      source: "storefront_reorder",
    })

    expect(result).toMatchObject({
      httpStatus: 500,
      ok: false,
      status: "notification_failed",
    })
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "legacy_reorder_notification_failed",
        severity: "page",
        fingerprint: "legacy_reorder_request:notification_failed",
        meta: expect.objectContaining({
          customer_id: "cus_legacy",
          source: "storefront_reorder",
          legacy_history_key: "legacy:item",
          legacy_item_id: "80000123",
          sku: "10-20",
          error_message: "postmark unavailable",
        }),
      })
    )
    expect(
      builders.some(
        ({ table, builder }) =>
          table === "legacy_reorder_request" && builder.update.mock.calls.length
      )
    ).toBe(true)
  })
})
