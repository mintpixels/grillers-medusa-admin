import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { syncProductWorkflow } from "../workflows/sync-product-to-strapi";
import { emitProductStrapiSyncFailureAlert } from "../lib/product-strapi-sync-alert";

export default async function productCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    const { result } = await syncProductWorkflow(container).run({
      input: { id: data.id },
    });
    return result;
  } catch (err) {
    const logger = container.resolve("logger");
    logger.error(`product.created → sync to Strapi failed for ID ${data.id}:`, err);
    await emitProductStrapiSyncFailureAlert({
      action: "created",
      medusaProductId: data.id,
      error: err,
      logger,
    });
  }
}

export const config: SubscriberConfig = {
  event: "product.created",
};
