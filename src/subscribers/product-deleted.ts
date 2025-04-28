import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import StrapiModuleService from "../modules/strapi/service";
import { STRAPI_MODULE } from "../modules/strapi";

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
      return;
    }

    await strapiSvc.deleteProduct(existing.documentId);
  } catch (err: any) {
    logger.error(
      `product.deleted → failed to delete Strapi entry for Medusa ID ${data.id}:`,
      err.response?.data ?? err.message ?? err
    );
  }
}

export const config: SubscriberConfig = {
  event: "product.deleted",
};
