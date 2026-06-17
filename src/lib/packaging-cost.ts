/**
 * Deterministic packaging-cost estimator for the checkout shipping forecast.
 *
 * The freight forecast (`shipping-cost-forecast.ts`) predicts the UPS carrier
 * charge only. It omits two real costs Peter flagged: DRY ICE and the SHIPPER
 * BOX (inner styrofoam + outer cardboard). This module estimates those two as
 * additive components from the order's estimated product weight and the
 * destination's transit days, using Peter's packing rules (2026-06-16):
 *
 *   - A dry-ice "block" is 7 lb. A box gets 2 blocks (14 lb) for 1-2 day
 *     transit, 3 blocks (21 lb) for 3-day transit. 50 lb hard cap per box
 *     (product + dry ice + packaging), so orders above capacity split boxes.
 *   - Shipper cost is fully loaded (foam + cardboard): micro $7.54,
 *     330-medium $9.98, 345-large $16.06. The 345 is the workhorse.
 *   - Dry ice is $0.60/lb.
 *
 * Validated by `analysis/packaging-cost-reconciliation.mjs` against QuickBooks:
 * modeled dry ice ≈ 116% of Emory's annual lbs (conservative), modeled box
 * spend ≈ 96% of the combined Drew Foam + Rocket + U-Line bills, with a 77%
 * 345-large mix. Keep the constants here in sync with that script.
 */
import { UPS_GROUND_TRANSIT_DAYS_BY_PREFIX } from "./ups-ground-transit-days";

export type PackagingCostInput = {
  /** Estimated PRODUCT weight (lb), excluding dry ice/packaging. */
  estimatedProductWeightLb: number;
  /** Normalized UPS service code: GROUND | 3_DAY_SELECT | 2ND_DAY_AIR | OVERNIGHT. */
  service?: string | null;
  /** Destination postal code (US ZIP). */
  shipPostalCode?: string | null;
};

export type PackagingCostConfig = {
  dryIceUsdPerLb: number;
  boxCost: { micro: number; m330: number; l345: number };
  dryIcePerBoxShortLb: number; // 1-2 day transit
  dryIcePerBoxLongLb: number; // 3+ day transit
  maxBoxTotalLb: number; // hard cap incl. product + dry ice + tare
  boxTareLb: number; // foam + cardboard weight reserved against the cap
  // Per-box BILLED-weight ceilings (product/box + dry ice/box) for tier choice.
  microBilledCeilLb: number;
  m330BilledCeilLb: number;
};

/** Peter's confirmed numbers (2026-06-16). Tier ceilings calibrated against QBD
 *  ground truth (analysis/packaging-box-tier-recalibration.mjs, 2026-06-17):
 *  fitted on 1,855 single-box orders joining the actual invoice Shipper line to
 *  the Unishippers billed weight. micro<=20 / m330<=33 lb gives 80.6% per-order
 *  accuracy (vs 55.6% for the old 8/25 guess) and an avg box cost of $12.37/order
 *  vs the actual $12.01 — weight alone caps near 80% since box choice is partly
 *  volume-driven and we have no product dimensions. */
export const DEFAULT_PACKAGING_CONFIG: PackagingCostConfig = {
  dryIceUsdPerLb: 0.6,
  boxCost: { micro: 7.54, m330: 9.98, l345: 16.06 },
  dryIcePerBoxShortLb: 14,
  dryIcePerBoxLongLb: 21,
  maxBoxTotalLb: 50,
  boxTareLb: 3,
  microBilledCeilLb: 20,
  m330BilledCeilLb: 33,
};

export type PackagingCostResult = {
  transitDays: number;
  boxes: number;
  boxTier: "micro" | "m330" | "l345";
  dryIceLb: number;
  dryIceCost: number;
  boxCost: number;
  total: number;
};

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? (n as number) : 0;
}

/**
 * Business-day transit from the Atlanta origin (30340) to the destination.
 * Air services are fixed; Ground uses the ZIP3 transit table (default 5 = far).
 */
export function transitDaysForOrder(
  service?: string | null,
  shipPostalCode?: string | null
): number {
  const s = String(service || "").toUpperCase();
  if (s.includes("OVERNIGHT") || s.includes("NEXT_DAY") || s.includes("NEXT DAY")) return 1;
  if (s.includes("2ND_DAY") || s.includes("2_DAY") || s.includes("2ND DAY") || s.includes("2 DAY"))
    return 2;
  if (s.includes("3_DAY") || s.includes("3 DAY")) return 3;
  // GROUND (and UPS_UNKNOWN/UNKNOWN, intentionally): ZIP3 lookup, default 5.
  // Treating an unknown service as Ground errs toward the long (21 lb) dry-ice
  // tier — conservative (never undercharges).
  const prefix = String(shipPostalCode || "").replace(/\D/g, "").slice(0, 3);
  return UPS_GROUND_TRANSIT_DAYS_BY_PREFIX[prefix] ?? 5;
}

/** Reads optional env overrides so costs can be tuned without a redeploy. */
/** Editable overrides sourced from Strapi cold-chain-setting (the costs that drift). */
export type PackagingCostOverrides = {
  dryIceUsdPerLb?: number | null;
  boxCost?: {
    micro?: number | null;
    m330?: number | null;
    l345?: number | null;
  };
};

/**
 * Resolve the packaging config by layering: hardcoded DEFAULT (Peter's
 * numbers) < Strapi overrides (ops-editable, no deploy) < env (devops
 * emergency override). A Strapi/env value only wins when it is a finite,
 * non-negative number; anything else is ignored so a blank Strapi field can't
 * zero out a cost.
 */
export function resolvePackagingConfig(
  opts: {
    strapi?: PackagingCostOverrides | null;
    env?: Record<string, string | undefined>;
  } = {}
): PackagingCostConfig {
  const env = opts.env ?? process.env;
  const d = DEFAULT_PACKAGING_CONFIG;

  // Only a finite POSITIVE number overrides a default. Every packaging value
  // (price, costs, lbs, capacities) is meaningfully > 0, so a blank, null, or
  // 0 Strapi/env value is rejected and falls back to the default — a stray 0
  // can never zero out a cost.
  const valid = (v: unknown): number | null => {
    const n = typeof v === "string" ? Number(v) : (v as number);
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
  };
  // Precedence: env > strapi > default.
  const pick = (envKey: string, strapiVal: unknown, def: number): number => {
    const e = env[envKey];
    if (e != null && e !== "") {
      const n = valid(e);
      if (n != null) return n;
    }
    const s = valid(strapiVal);
    if (s != null) return s;
    return def;
  };

  const s = opts.strapi ?? {};
  return {
    dryIceUsdPerLb: pick("GRILLERS_DRY_ICE_USD_PER_LB", s.dryIceUsdPerLb, d.dryIceUsdPerLb),
    boxCost: {
      micro: pick("GRILLERS_BOX_COST_MICRO", s.boxCost?.micro, d.boxCost.micro),
      m330: pick("GRILLERS_BOX_COST_330", s.boxCost?.m330, d.boxCost.m330),
      l345: pick("GRILLERS_BOX_COST_345", s.boxCost?.l345, d.boxCost.l345),
    },
    // Physical packing rules (stable): env-overridable, not Strapi-editable.
    dryIcePerBoxShortLb: pick("GRILLERS_DRY_ICE_PER_BOX_SHORT_LB", undefined, d.dryIcePerBoxShortLb),
    dryIcePerBoxLongLb: pick("GRILLERS_DRY_ICE_PER_BOX_LONG_LB", undefined, d.dryIcePerBoxLongLb),
    maxBoxTotalLb: pick("GRILLERS_MAX_BOX_TOTAL_LB", undefined, d.maxBoxTotalLb),
    boxTareLb: pick("GRILLERS_BOX_TARE_LB", undefined, d.boxTareLb),
    microBilledCeilLb: pick("GRILLERS_MICRO_BILLED_CEIL_LB", undefined, d.microBilledCeilLb),
    m330BilledCeilLb: pick("GRILLERS_M330_BILLED_CEIL_LB", undefined, d.m330BilledCeilLb),
  };
}

/** Back-compat: env (over default) only, no Strapi layer. */
export function packagingConfigFromEnv(
  env: Record<string, string | undefined> = process.env
): PackagingCostConfig {
  return resolvePackagingConfig({ env });
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Estimate dry-ice + box cost for an order. Pure function of product weight +
 * transit days + config. Never throws; clamps to sane values.
 */
export function estimatePackagingCost(
  input: PackagingCostInput,
  config: PackagingCostConfig = DEFAULT_PACKAGING_CONFIG
): PackagingCostResult {
  const transitDays = transitDaysForOrder(input.service, input.shipPostalCode);
  const dryIcePerBox =
    transitDays <= 2 ? config.dryIcePerBoxShortLb : config.dryIcePerBoxLongLb;

  // Usable product capacity per box once dry ice + tare are subtracted from the
  // 50 lb cap. Floor at 1 lb so a degenerate config can't divide by zero.
  const usableProductPerBox = Math.max(
    1,
    config.maxBoxTotalLb - dryIcePerBox - config.boxTareLb
  );

  const productWeight = Math.max(0, num(input.estimatedProductWeightLb));
  const boxes = Math.max(1, Math.ceil(productWeight / usableProductPerBox));

  // Tier by per-box GROSS billed weight = product/box + dry ice + box tare.
  // This must include the tare to match the reconciliation script, which tiers
  // on the UPS gross billed weight (TOTAL_RATED_WEIGHT, which already includes
  // foam + cardboard). Dropping the tare here would shift orders down a tier
  // and undercharge in the ~8-11 lb-product band.
  const perBoxBilled = productWeight / boxes + dryIcePerBox + config.boxTareLb;
  const boxTier: PackagingCostResult["boxTier"] =
    perBoxBilled <= config.microBilledCeilLb
      ? "micro"
      : perBoxBilled <= config.m330BilledCeilLb
        ? "m330"
        : "l345";

  const dryIceLb = boxes * dryIcePerBox;
  const dryIceCost = round2(dryIceLb * config.dryIceUsdPerLb);
  const boxCost = round2(boxes * config.boxCost[boxTier]);
  const total = round2(boxCost + dryIceCost);

  return { transitDays, boxes, boxTier, dryIceLb, dryIceCost, boxCost, total };
}
