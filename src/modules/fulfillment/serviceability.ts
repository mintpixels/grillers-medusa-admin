// src/modules/fulfillment/serviceability.ts
//
// Shared serviceability check for zip/city-restricted shipping methods.
//
// Only ATLANTA_DELIVERY (zip-gated via Strapi atlanta-delivery-zones) and
// SCHEDULED_DELIVERY (city/state-gated via Strapi shipping-zones) restrict the
// destinations they serve. UPS services (GROUND, 3_DAY_SELECT, 2ND_DAY_AIR,
// OVERNIGHT) and PICKUP serve everywhere, so they always pass.
//
// CRITICAL — this helper FAILS OPEN: if Strapi is unreachable / returns non-ok,
// or we can't determine the destination, we return `true`. A transient Strapi
// outage must never hide a legitimate shipping method.

import { FULFILLMENT_SERVICES, normalizeServiceCode } from "./service";

export const ZIP_RESTRICTED_SERVICE_CODES = new Set<string>([
  "ATLANTA_DELIVERY",
  "SCHEDULED_DELIVERY",
]);

export type ServiceabilityAddress = {
  postal_code?: string | null;
  city?: string | null;
  province?: string | null;
};

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function recordObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

/**
 * Best-effort service_code for a shipping method or shipping option shape.
 *
 * Priority: explicit service_code on the method's `data`, then on the linked
 * shipping option's `data`, then a direct `service_code` field, and finally the
 * human-readable name matched against a FULFILLMENT_SERVICES entry. Returns the
 * normalized code (e.g. "ATLANTA_DELIVERY", "GROUND"), or "" if undeterminable.
 */
export function resolveServiceCodeFromMethod(
  method: Record<string, any> | null | undefined
): string {
  if (!method) return "";

  const data = recordObject(method.data);
  const option = recordObject(method.shipping_option);
  const optionData = recordObject(option.data);

  // 1) Explicit service_code anywhere obvious.
  const explicit = firstString(
    data.service_code,
    optionData.service_code,
    method.service_code,
    option.service_code
  );
  if (explicit) {
    return normalizeServiceCode(explicit);
  }

  // 2) Match the name to a known FULFILLMENT_SERVICES entry (e.g. "Metro Atlanta
  //    Delivery" -> ATLANTA_DELIVERY). normalizeServiceCode collapses UPS variants
  //    but not the restricted names, so match those exactly by name first.
  const name = firstString(method.name, option.name);
  if (name) {
    const byName = FULFILLMENT_SERVICES.find(
      (svc) => svc.name.toLowerCase() === name.toLowerCase()
    );
    if (byName) {
      return normalizeServiceCode(byName.code);
    }
    // Layer 3 robustness: the /store/shipping-options response usually has no
    // service_code, so detection of the two RESTRICTED services hinges on the
    // option name. If an admin renamed the option even slightly the exact match
    // above misses it, and the generic normalizer below would not recover the
    // restricted code — silently keeping a restricted option. Apply a narrow
    // fuzzy match for the two restricted services ONLY (not UPS/pickup).
    const lowered = name.toLowerCase();
    if (lowered.includes("atlanta")) {
      return "ATLANTA_DELIVERY";
    }
    if (lowered.includes("scheduled")) {
      return "SCHEDULED_DELIVERY";
    }
    // Fall back to the fuzzy normalizer for UPS-style names.
    return normalizeServiceCode(name);
  }

  return "";
}

function strapiRow<T extends Record<string, unknown>>(row: unknown): T | null {
  if (!row || typeof row !== "object") return null;
  const value = row as Record<string, unknown>;
  return ((value.attributes as T | undefined) || (value as T)) ?? null;
}

/**
 * True when `serviceCode` can deliver to `address`.
 *
 * - Non-restricted codes (UPS/PICKUP/unknown) -> always true.
 * - ATLANTA_DELIVERY -> true iff Strapi has an active atlanta-delivery-zone for
 *   the ZIP, OR (mirroring the more-permissive live pricing) the generic
 *   shipping-zones table has a row whose ZIPCode == ZIP. Only false when NEITHER
 *   table has it.
 * - SCHEDULED_DELIVERY -> true iff Strapi shipping-zones has a row whose
 *   City == address.city AND State == address.province (mirrors the live
 *   pricing match in service.ts).
 * - No usable address, or any Strapi error/non-ok -> true (fail open).
 */
export async function isDestinationServiceable(
  serviceCode: string,
  address: ServiceabilityAddress | null | undefined
): Promise<boolean> {
  const normalized = normalizeServiceCode(serviceCode);

  // UPS / PICKUP / unknown codes serve everywhere.
  if (!ZIP_RESTRICTED_SERVICE_CODES.has(normalized)) {
    return true;
  }

  // Can't determine destination -> don't restrict.
  if (!address) {
    return true;
  }

  const zip = typeof address.postal_code === "string" ? address.postal_code.trim() : "";
  const city = typeof address.city === "string" ? address.city.trim() : "";
  const province =
    typeof address.province === "string" ? address.province.trim() : "";

  const strapiUrl = process.env.STRAPI_URL;
  const strapiToken = process.env.STRAPI_TOKEN;

  if (normalized === "ATLANTA_DELIVERY") {
    // No ZIP -> can't determine; fail open.
    if (!zip) return true;
    try {
      const params = new URLSearchParams({
        "filters[ZipCode][$eq]": zip,
        "filters[IsActive][$eq]": "true",
        "pagination[limit]": "1",
      });
      const response = await fetch(
        `${strapiUrl}/api/atlanta-delivery-zones?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${strapiToken}`,
          },
        }
      );
      if (!response.ok) {
        // FAIL OPEN on a non-ok Strapi response.
        console.warn(
          `[serviceability] atlanta-delivery-zones lookup for ${zip} returned ${response.status}; failing open`
        );
        return true;
      }
      const body = (await response.json()) as { data?: unknown };
      const zone = strapiRow<Record<string, unknown>>(
        Array.isArray(body?.data) ? body.data[0] : undefined
      );
      if (zone) return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[serviceability] atlanta-delivery-zones lookup for ${zip} threw (${message}); failing open`
      );
      return true;
    }

    // The atlanta-delivery-zones table did not have this ZIP. The LIVE pricing
    // in service.ts is more permissive: after the atlanta-delivery-zones lookup
    // it ALSO matches ATLANTA_DELIVERY against the generic shipping-zones table
    // by `z.ZIPCode == zip`. A ZIP present only in shipping-zones prices fine at
    // checkout, so it must be treated as serviceable here too — otherwise we'd
    // strip a legitimate option. Only when NEITHER table has the ZIP do we
    // report it unserviceable.
    try {
      const response = await fetch(
        `${strapiUrl}/api/shipping-zones?populate=*`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${strapiToken}`,
          },
        }
      );
      if (!response.ok) {
        console.warn(
          `[serviceability] shipping-zones fallback for ATLANTA_DELIVERY ${zip} returned ${response.status}; failing open`
        );
        return true;
      }
      const body = (await response.json()) as { data?: unknown };
      const zones = Array.isArray(body?.data) ? body.data : [];
      // Mirror the ATLANTA_DELIVERY match in service.ts: a zone whose
      // ZIPCode == zip.
      const match = zones.some((row) => {
        const z = strapiRow<Record<string, unknown>>(row) || {};
        return z.ZIPCode === zip;
      });
      return match;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[serviceability] shipping-zones fallback for ATLANTA_DELIVERY ${zip} threw (${message}); failing open`
      );
      return true;
    }
  }

  if (normalized === "SCHEDULED_DELIVERY") {
    // No city/state -> can't determine; fail open.
    if (!city || !province) return true;
    try {
      const response = await fetch(
        `${strapiUrl}/api/shipping-zones?populate=*`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${strapiToken}`,
          },
        }
      );
      if (!response.ok) {
        console.warn(
          `[serviceability] shipping-zones lookup for SCHEDULED_DELIVERY ${city}/${province} returned ${response.status}; failing open`
        );
        return true;
      }
      const body = (await response.json()) as { data?: unknown };
      const zones = Array.isArray(body?.data) ? body.data : [];
      // Mirror the SCHEDULED_DELIVERY match in service.ts: a zone with no Zip,
      // City == city, State == province.
      const match = zones.some((row) => {
        const z = strapiRow<Record<string, unknown>>(row) || {};
        return !z.Zip && z.City === city && z.State === province;
      });
      return match;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[serviceability] shipping-zones lookup for SCHEDULED_DELIVERY ${city}/${province} threw (${message}); failing open`
      );
      return true;
    }
  }

  // Unreachable (every restricted code handled above) — fail open defensively.
  return true;
}
