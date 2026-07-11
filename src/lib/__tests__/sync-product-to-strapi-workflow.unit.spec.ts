import { WorkflowManager } from "@medusajs/framework/orchestration";
import { assertResolvedProduct } from "../../workflows/sync-product-to-strapi";

describe("syncProductWorkflow", () => {
  it("retries synchronously so the resolved step input and original error stay in memory", () => {
    const workflow = WorkflowManager.getWorkflow("sync-product-to-strapi") as any;
    const syncStep = workflow.flow_.next;

    expect(syncStep).toMatchObject({
      action: "sync-product-to-strapi",
      maxRetries: 3,
    });
    expect(syncStep).not.toHaveProperty("retryInterval");
  });

  it("fails clearly before service use when no resolved product is available", () => {
    expect(() => assertResolvedProduct(undefined)).toThrow(
      "Strapi product sync requires a resolved Medusa product with an ID"
    );
    expect(() => assertResolvedProduct({ id: "" })).toThrow(
      "Strapi product sync requires a resolved Medusa product with an ID"
    );
    expect(() => assertResolvedProduct({ id: "prod_1" })).not.toThrow();
  });
});
