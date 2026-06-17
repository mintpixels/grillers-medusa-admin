/**
 * Loads ops-editable packaging costs from Strapi (cold-chain-setting) so the
 * dry-ice price and per-box costs can change without an admin redeploy. Values
 * layer as: hardcoded default (Peter's numbers) < Strapi < env override.
 *
 * Strapi cold-chain-setting fields consumed:
 *   - DryIcePricePerLb  -> dryIceUsdPerLb
 *   - BoxCostMicro      -> boxCost.micro
 *   - BoxCost330        -> boxCost.m330
 *   - BoxCost345        -> boxCost.l345
 *
 * Never throws and never blocks the rate path: any fetch failure or missing
 * field falls back to the hardcoded defaults (which are correct). The fetched
 * overrides are cached briefly so we don't hit Strapi on every rate quote.
 */
import {
  resolvePackagingConfig,
  type PackagingCostConfig,
  type PackagingCostOverrides,
} from "./packaging-cost";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cache: { value: PackagingCostOverrides; at: number } | null = null;

/** Reset the in-memory cache (tests). */
export function resetPackagingOverridesCache(): void {
  cache = null;
}

/** Maps a cold-chain-setting record (Strapi v4 or v5 shape) to overrides. */
export function packagingOverridesFromColdChainSetting(
  setting: unknown
): PackagingCostOverrides {
  const root =
    setting && typeof setting === "object" ? (setting as Record<string, any>) : {};
  const s = (root.attributes as Record<string, any>) ?? root;
  return {
    dryIceUsdPerLb: s?.DryIcePricePerLb ?? null,
    boxCost: {
      micro: s?.BoxCostMicro ?? null,
      m330: s?.BoxCost330 ?? null,
      l345: s?.BoxCost345 ?? null,
    },
  };
}

/** Fetches the cold-chain-setting single type from Strapi. Returns {} on any failure. */
export async function fetchPackagingOverridesFromStrapi(
  env: Record<string, string | undefined> = process.env
): Promise<PackagingCostOverrides> {
  const base = env.STRAPI_URL;
  const token = env.STRAPI_TOKEN;
  if (!base) return {};
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/api/cold-chain-setting`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return {};
    const json = (await res.json()) as { data?: unknown };
    return packagingOverridesFromColdChainSetting(json?.data ?? json);
  } catch {
    return {};
  }
}

/**
 * Resolve the packaging config, layering Strapi overrides (cached) over the
 * hardcoded defaults, with env as the final override. `now` is injectable for
 * tests.
 */
export async function getPackagingConfig(
  env: Record<string, string | undefined> = process.env,
  now: number = Date.now()
): Promise<PackagingCostConfig> {
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    const overrides = await fetchPackagingOverridesFromStrapi(env);
    cache = { value: overrides, at: now };
  }
  return resolvePackagingConfig({ strapi: cache.value, env });
}
