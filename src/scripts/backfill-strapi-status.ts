/**
 * Backfill Medusa `status` → Strapi `MedusaProduct.Status` for every product.
 *
 * Run with:
 *   npx medusa exec ./src/scripts/backfill-strapi-status.ts
 *
 * Safe to re-run — the sync workflow is upsert-style. Products that exist in
 * Medusa will have their Status refreshed in Strapi; products that were never
 * in Medusa are left alone (this script can't see them).
 *
 * After the sync, Strapi's Algolia transformerCallback will re-filter: only
 * products with MedusaProduct.Status === "published" get indexed. Orphans /
 * drafts drop out on their next Algolia reindex (triggered by the re-sync).
 */

import { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { syncProductWorkflow } from "../workflows/sync-product-to-strapi";

export default async function backfillStrapiStatus({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  logger.info("[backfill] fetching all Medusa products...");
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "status", "title"],
  });
  logger.info(`[backfill] found ${products.length} product(s)`);

  let ok = 0;
  let failed = 0;
  const failures: Array<{ id: string; title: string; error: string }> = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    try {
      await syncProductWorkflow(container).run({ input: { id: p.id } });
      ok++;
      if ((i + 1) % 25 === 0) {
        logger.info(`[backfill] ${i + 1}/${products.length} done (ok=${ok}, failed=${failed})`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ id: p.id, title: p.title, error: msg });
      logger.error(`[backfill] failed ${p.id} (${p.title}): ${msg}`);
    }
  }

  logger.info(`[backfill] done. ok=${ok} failed=${failed} total=${products.length}`);
  if (failures.length) {
    logger.error(`[backfill] failures:\n${JSON.stringify(failures, null, 2)}`);
  }
}
