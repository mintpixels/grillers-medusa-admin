import {
  createStep,
  StepResponse,
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { useQueryGraphStep } from "@medusajs/medusa/core-flows";
import StrapiModuleService from "../modules/strapi/service";
import { STRAPI_MODULE } from "../modules/strapi";

type SyncStepInput = { product: any };

export const syncProductStep = createStep(
  {
    name: "sync-product-to-strapi",
    maxRetries: 3,
    retryInterval: 10,
  },
  async ({ product }, { container }) => {
    const strapiSvc = container.resolve(STRAPI_MODULE) as StrapiModuleService;

    const existing = await strapiSvc.findProductByMedusaId(product.id);

    let strapiId: string;

    if (existing) {
      strapiId = existing.documentId;
      await strapiSvc.updateProduct(strapiId, product);
    } else {
      const created = await strapiSvc.createProduct(product);
      // @ts-ignore
      strapiId = created.data.documentId;
    }

    return new StepResponse(undefined, strapiId);
  },
  async (strapiId, { container }) => {
    // Compensation: delete the Strapi entry if workflow fails later
    if (strapiId) {
      const strapiSvc = container.resolve(STRAPI_MODULE) as StrapiModuleService;
      await strapiSvc.deleteProduct(strapiId);
    }
  }
);

/**
 * Workflow: Fetch full product (with variants) by Medusa ID, then sync to Strapi.
 */
export const syncProductWorkflow = createWorkflow(
  "sync-product-to-strapi",
  (input: { id: string }) => {
    // @ts-ignore
    const { data: products } = useQueryGraphStep({
      entity: "product",
      fields: ["*", "variants.*"],
      filters: { id: input.id },
      options: { throwIfKeyNotFound: true },
    });

    // @ts-ignore
    syncProductStep({ product: products[0] });

    return new WorkflowResponse({
      syncedProductId: products[0].id,
    });
  }
);
