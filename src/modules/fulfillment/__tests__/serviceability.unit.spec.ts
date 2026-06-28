import { emitOpsAlert } from "../../../lib/ops-alert"
import {
  isDestinationServiceable,
  resolveServiceCodeFromMethod,
  ZIP_RESTRICTED_SERVICE_CODES,
} from "../serviceability"

jest.mock("../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async (_input: any) => ({ ok: true, skipped: false })),
}))

function mockFetchOk(data: any) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data }),
  } as any)
}

function mockFetchNotOk(status = 503) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: "down" }),
  } as any)
}

function mockFetchThrows() {
  global.fetch = jest.fn().mockRejectedValue(new Error("network down"))
}

// Returns a distinct ok response for each successive fetch call (in order),
// reusing the last entry for any further calls.
function mockFetchOkSequence(...payloads: any[]) {
  let call = 0
  global.fetch = jest.fn().mockImplementation(async () => {
    const data = payloads[Math.min(call, payloads.length - 1)]
    call += 1
    return { ok: true, json: async () => ({ data }) } as any
  })
}

describe("serviceability", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    ;(emitOpsAlert as jest.Mock).mockClear()
    process.env.STRAPI_URL = "https://strapi.example.test"
    process.env.STRAPI_TOKEN = "strapi-token"
  })

  describe("ZIP_RESTRICTED_SERVICE_CODES", () => {
    it("contains exactly the two restricted codes", () => {
      expect(Array.from(ZIP_RESTRICTED_SERVICE_CODES).sort()).toEqual([
        "ATLANTA_DELIVERY",
        "SCHEDULED_DELIVERY",
      ])
    })
  })

  describe("isDestinationServiceable", () => {
    it("returns true for a non-restricted code (GROUND) without any fetch", async () => {
      global.fetch = jest.fn()
      const ok = await isDestinationServiceable("GROUND", {
        postal_code: "38120",
      })
      expect(ok).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("returns true for PICKUP without any fetch", async () => {
      global.fetch = jest.fn()
      const ok = await isDestinationServiceable("PICKUP", {
        postal_code: "38120",
      })
      expect(ok).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("ATLANTA_DELIVERY is serviceable when Strapi returns a zone", async () => {
      mockFetchOk([{ id: 1, ZipCode: "30340", IsActive: true }])
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        postal_code: "30340",
      })
      expect(ok).toBe(true)
      expect(global.fetch).toHaveBeenCalledTimes(1)
    })

    it("ATLANTA_DELIVERY is NOT serviceable when neither table has the ZIP", async () => {
      // atlanta-delivery-zones empty AND shipping-zones has no ZIPCode match.
      mockFetchOkSequence([], [{ ZIPCode: "30301" }])
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        postal_code: "38120",
      })
      expect(ok).toBe(false)
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it("ATLANTA_DELIVERY is serviceable when ZIP is missing from atlanta-delivery-zones but present in shipping-zones (ZIPCode match)", async () => {
      // Mirrors the live pricing fallback in service.ts (z.ZIPCode == zip):
      // atlanta-delivery-zones returns empty, but shipping-zones carries the ZIP.
      mockFetchOkSequence(
        [],
        [
          { ZIPCode: "30305" },
          { ZIPCode: "30340" },
        ]
      )
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        postal_code: "30340",
      })
      expect(ok).toBe(true)
      // First call = atlanta-delivery-zones, second = shipping-zones fallback.
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it("ATLANTA_DELIVERY fails open (true) when the fetch throws", async () => {
      mockFetchThrows()
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        postal_code: "38120",
      })
      expect(ok).toBe(true)
      expect(emitOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertKind: "fulfillment_serviceability_failed_open",
          severity: "warn",
          path: "src/modules/fulfillment/serviceability.ts",
          meta: expect.objectContaining({
            service_code: "ATLANTA_DELIVERY",
            lookup: "atlanta_delivery_zones",
            status: null,
            error_message: "network down",
            failed_open: true,
          }),
        })
      )
    })

    it("ATLANTA_DELIVERY fails open (true) when Strapi returns non-ok", async () => {
      mockFetchNotOk(503)
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        postal_code: "38120",
      })
      expect(ok).toBe(true)
      expect(emitOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertKind: "fulfillment_serviceability_failed_open",
          meta: expect.objectContaining({
            service_code: "ATLANTA_DELIVERY",
            lookup: "atlanta_delivery_zones",
            status: 503,
            error_message: null,
            failed_open: true,
          }),
        })
      )
    })

    it("ATLANTA_DELIVERY fails open (true) when there is no ZIP", async () => {
      global.fetch = jest.fn()
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", {
        city: "Memphis",
        province: "TN",
      })
      expect(ok).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("returns true when address is null (can't determine)", async () => {
      global.fetch = jest.fn()
      const ok = await isDestinationServiceable("ATLANTA_DELIVERY", null)
      expect(ok).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it("normalizes the service code before checking (case/spacing insensitive)", async () => {
      // Both atlanta-delivery-zones and the shipping-zones fallback return empty
      // -> the ZIP is in neither table -> unserviceable.
      mockFetchOk([])
      const ok = await isDestinationServiceable("atlanta delivery", {
        postal_code: "38120",
      })
      expect(ok).toBe(false)
      // 1) atlanta-delivery-zones lookup, 2) shipping-zones fallback.
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })

    it("SCHEDULED_DELIVERY is serviceable when shipping-zones has a matching city/state row", async () => {
      mockFetchOk([
        { Zip: null, City: "Atlanta", State: "GA" },
        { Zip: null, City: "Savannah", State: "GA" },
      ])
      const ok = await isDestinationServiceable("SCHEDULED_DELIVERY", {
        city: "Savannah",
        province: "GA",
      })
      expect(ok).toBe(true)
    })

    it("SCHEDULED_DELIVERY is NOT serviceable when no city/state row matches", async () => {
      mockFetchOk([{ Zip: null, City: "Atlanta", State: "GA" }])
      const ok = await isDestinationServiceable("SCHEDULED_DELIVERY", {
        city: "Memphis",
        province: "TN",
      })
      expect(ok).toBe(false)
    })

    it("SCHEDULED_DELIVERY fails open (true) when the fetch throws", async () => {
      mockFetchThrows()
      const ok = await isDestinationServiceable("SCHEDULED_DELIVERY", {
        city: "Memphis",
        province: "TN",
      })
      expect(ok).toBe(true)
      expect(emitOpsAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertKind: "fulfillment_serviceability_failed_open",
          meta: expect.objectContaining({
            service_code: "SCHEDULED_DELIVERY",
            lookup: "scheduled_delivery_shipping_zones",
            error_message: "network down",
            failed_open: true,
          }),
        })
      )
    })

    it("SCHEDULED_DELIVERY fails open (true) when city or state is missing", async () => {
      global.fetch = jest.fn()
      const ok = await isDestinationServiceable("SCHEDULED_DELIVERY", {
        city: "Memphis",
      })
      expect(ok).toBe(true)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  describe("resolveServiceCodeFromMethod", () => {
    it("reads service_code from method.data", () => {
      expect(
        resolveServiceCodeFromMethod({ data: { service_code: "ATLANTA_DELIVERY" } })
      ).toBe("ATLANTA_DELIVERY")
    })

    it("reads service_code from the linked shipping option data", () => {
      expect(
        resolveServiceCodeFromMethod({
          shipping_option: { data: { service_code: "SCHEDULED_DELIVERY" } },
        })
      ).toBe("SCHEDULED_DELIVERY")
    })

    it("falls back to matching the method name to a known service", () => {
      expect(
        resolveServiceCodeFromMethod({ name: "Metro Atlanta Delivery" })
      ).toBe("ATLANTA_DELIVERY")
    })

    it("normalizes a fuzzy UPS name when no exact match", () => {
      expect(
        resolveServiceCodeFromMethod({ name: "UPS Ground Estimated Shipping" })
      ).toBe("GROUND")
    })

    it("fuzzy-matches a drifted ATLANTA_DELIVERY name (admin renamed the option)", () => {
      expect(
        resolveServiceCodeFromMethod({
          name: "Metro Atlanta Same-Day Delivery",
        })
      ).toBe("ATLANTA_DELIVERY")
    })

    it("fuzzy-matches a drifted SCHEDULED_DELIVERY name", () => {
      expect(
        resolveServiceCodeFromMethod({ name: "Scheduled In-Home Delivery" })
      ).toBe("SCHEDULED_DELIVERY")
    })

    it("returns '' for an empty method", () => {
      expect(resolveServiceCodeFromMethod(null)).toBe("")
      expect(resolveServiceCodeFromMethod({})).toBe("")
    })
  })
})
