import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import StrapiModuleService from "../modules/strapi/service";
import { STRAPI_MODULE } from "../modules/strapi";
import {
  emitProductStrapiDeleteSkippedAlert,
  emitProductStrapiSyncFailureAlert,
} from "../lib/product-strapi-sync-alert";

export default async function productDeletedHandler(args: SubscriberArgs<{ id: string }>) {
  const {
    event: { data },
    container,
  } = args;

  const logger = container.resolve("logger");
  try {
    const strapiSvc = container.resolve(STRAPI_MODULE) as StrapiModuleService;

    const existing = await strapiSvc.findProductByMedusaId(data.id);
    if (!existing) {
      logger.warn(`Strapi entry not found for Medusa ID ${data.id}, nothing to delete.`);
      await emitProductStrapiDeleteSkippedAlert({
        medusaProductId: data.id,
        reason: "missing_strapi_entry",
        logger,
      });
      return;
    }

    const response = await strapiSvc.deleteProduct(existing.documentId);
    if (response?.status === 202) {
      await emitProductStrapiDeleteSkippedAlert({
        medusaProductId: data.id,
        strapiDocumentId: existing.documentId,
        reason: "destructive_sync_disabled",
        logger,
      });
    }
  } catch (err: any) {
    logger.error(
      `product.deleted → failed to delete Strapi entry for Medusa ID ${data.id}:`,
      err.response?.data ?? err.message ?? err
    );
    await emitProductStrapiSyncFailureAlert({
      action: "deleted",
      medusaProductId: data.id,
      error: err,
      logger,
    });
  }
}

export const config: SubscriberConfig = {
  event: "product.deleted",
};
