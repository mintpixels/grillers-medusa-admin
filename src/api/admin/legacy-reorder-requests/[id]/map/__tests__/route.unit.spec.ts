import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { POST } from "../route"
import { upsertLegacyItemMapping } from "../../../../../../lib/legacy-item-mapping"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

jest.mock("../../../../../../lib/legacy-item-mapping", () => ({
  upsertLegacyItemMapping: jest.fn(),
}))

jest.mock("../../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
  return res
}

function makeBuilder(firstResult?: unknown) {
  const builder: any = {
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    first: jest.fn(async () => firstResult),
    update: jest.fn(async () => undefined),
  }
  return builder
}

function makeReq() {
  const db: any = jest.fn(() =>
    makeBuilder({
      id: "lgrreq_123",
      legacy_history_key: "legacy:item",
      legacy_item_id: "80000123",
      sku: "QB-10-20",
      title: "Legacy item",
    })
  )
  db.raw = jest.fn()

  return {
    params: { id: "lgrreq_123" },
    body: {
      medusa_sku: "10-20",
      dry_run: false,
    },
    auth_context: { actor_id: "staff_1" },
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        if (key === ContainerRegistrationKeys.LOGGER) {
          return { warn: jest.fn(), error: jest.fn() }
        }
        return undefined
      },
    },
  } as any
}

describe("legacy reorder request mapping route alerting", () => {
  beforeEach(() => {
    ;(upsertLegacyItemMapping as jest.Mock).mockReset()
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  it("emits a warn alert when mapping a reorder request fails", async () => {
    ;(upsertLegacyItemMapping as jest.Mock).mockRejectedValue(
      new Error("variant not found")
    )

    const res = makeRes()
    await POST(makeReq(), res)

    expect(res.statusCode).toBe(400)
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "legacy_item_mapping_failed",
        severity: "warn",
        fingerprint: "legacy_item_mapping:reorder_request:400",
        meta: expect.objectContaining({
          request_id: "lgrreq_123",
          legacy_history_key: "legacy:item",
          qbd_item_list_id: "80000123",
          sku: "QB-10-20",
          medusa_sku: "10-20",
          dry_run: false,
          staff_actor_id: "staff_1",
          error_message: "variant not found",
        }),
      })
    )
  })
})
