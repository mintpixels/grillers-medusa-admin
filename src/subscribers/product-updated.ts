import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { syncProductWorkflow } from "../workflows/sync-product-to-strapi";

export default async function productUpdatedHandler({
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
    logger.error(`product.updated → sync to Strapi failed for ID ${data.id}:`, err);
  }
}

export const config: SubscriberConfig = {
  event: "product.updated",
};
