import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { POST } from "../route"
import { upsertLegacyItemMapping } from "../../../../../lib/legacy-item-mapping"
import { getLegacyItemMappingCandidate } from "../../../../../lib/legacy-item-mapping-review"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/legacy-item-mapping", () => ({
  upsertLegacyItemMapping: jest.fn(),
}))

jest.mock("../../../../../lib/legacy-item-mapping-review", () => ({
  getLegacyItemMappingCandidate: jest.fn(),
}))

jest.mock("../../../../../lib/ops-alert", () => ({
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

function makeReq() {
  return {
    body: {
      qbd_item_list_id: "80000123",
      medusa_sku: "10-20",
      dry_run: true,
    },
    auth_context: { actor_id: "staff_1" },
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return jest.fn()
        if (key === ContainerRegistrationKeys.LOGGER) {
          return { warn: jest.fn(), error: jest.fn() }
        }
        return undefined
      },
    },
  } as any
}

describe("legacy item mapping candidate route alerting", () => {
  beforeEach(() => {
    ;(upsertLegacyItemMapping as jest.Mock).mockReset()
    ;(getLegacyItemMappingCandidate as jest.Mock).mockReset()
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  it("emits a warn alert when a candidate mapping fails", async () => {
    ;(getLegacyItemMappingCandidate as jest.Mock).mockResolvedValue({
      key: "candidate:80000123",
      qbd_item_list_id: "80000123",
      sku: "QB-10-20",
      title: "Legacy item",
      description_group: null,
      sample_description: "Legacy item sample",
      line_count: 3,
      order_count: 2,
      customer_count: 2,
      requires_description_matcher: false,
    })
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
        fingerprint: "legacy_item_mapping:candidate:400",
        meta: expect.objectContaining({
          qbd_item_list_id: "80000123",
          sku: "QB-10-20",
          mapping_candidate_key: "candidate:80000123",
          medusa_sku: "10-20",
          dry_run: true,
          staff_actor_id: "staff_1",
          error_message: "variant not found",
        }),
      })
    )
  })
})
