import StrapiModuleService from "../service";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

function service() {
  return new StrapiModuleService(
    { logger: logger as any },
    { strapiUrl: "https://strapi.example.test", strapiToken: "token" }
  ) as any;
}

describe("StrapiModuleService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRAPI_ALLOW_DESTRUCTIVE_SYNC;
  });

  it("maps QuickBooks ListID metadata onto Strapi product and variant fields", () => {
    const payload = service().mapToStrapiPayload({
      id: "prod_1",
      title: "Ground Beef",
      description: "Ground beef",
      handle: "ground-beef",
      status: "published",
      metadata: { qbd_list_id: "QB-PRODUCT" },
      variants: [
        {
          id: "variant_1",
          title: "Default",
          sku: "1-00-12-0",
          metadata: { qbd_list_id: "QB-VARIANT" },
        },
      ],
    });

    expect(payload.MedusaProduct.QuickBooksListId).toBe("QB-PRODUCT");
    expect(payload.MedusaProduct.Variants[0].QuickBooksListId).toBe(
      "QB-VARIANT"
    );
  });

  it("falls back to product QuickBooks ListID metadata for variants", () => {
    const payload = service().mapToStrapiPayload({
      id: "prod_1",
      title: "Ground Beef",
      description: "Ground beef",
      handle: "ground-beef",
      status: "published",
      metadata: { quickbooks: { list_id: "QB-PRODUCT" } },
      variants: [
        {
          id: "variant_1",
          title: "Default",
          sku: "1-00-12-0",
          metadata: {},
        },
      ],
    });

    expect(payload.MedusaProduct.QuickBooksListId).toBe("QB-PRODUCT");
    expect(payload.MedusaProduct.Variants[0].QuickBooksListId).toBe(
      "QB-PRODUCT"
    );
  });

  it("maps waitlist and availability lifecycle metadata onto Strapi fields", () => {
    const payload = service().mapToStrapiPayload({
      id: "prod_1",
      title: "Passover Item",
      description: "Seasonal item",
      handle: "passover-item",
      status: "published",
      metadata: {
        qbd_list_id: "QB-PRODUCT",
        waitlist_enabled: false,
        availability_lifecycle: "seasonal_inactive",
      },
      variants: [
        {
          id: "variant_1",
          title: "Default",
          sku: "Y-1-00-12-0P",
          metadata: { qbd_list_id: "QB-VARIANT" },
        },
        {
          id: "variant_2",
          title: "Gluten Free",
          sku: "1-00-13-0P",
          metadata: {
            qbd_list_id: "QB-VARIANT-2",
            waitlist_enabled: true,
            availability_lifecycle: "active",
          },
        },
      ],
    });

    expect(payload.MedusaProduct.WaitlistEnabled).toBe(false);
    expect(payload.MedusaProduct.AvailabilityLifecycle).toBe(
      "seasonal_inactive"
    );
    expect(payload.MedusaProduct.Variants[0].WaitlistEnabled).toBe(false);
    expect(payload.MedusaProduct.Variants[0].AvailabilityLifecycle).toBe(
      "seasonal_inactive"
    );
    expect(payload.MedusaProduct.Variants[1].WaitlistEnabled).toBe(true);
    expect(payload.MedusaProduct.Variants[1].AvailabilityLifecycle).toBe(
      "active"
    );
  });

  it("preserves Strapi allocation policy fields during product sync", () => {
    const payload = service().mapToStrapiPayload(
      {
        id: "prod_1",
        title: "Ground Beef",
        description: "Ground beef",
        handle: "ground-beef",
        status: "published",
        metadata: { qbd_list_id: "QB-PRODUCT" },
        variants: [
          {
            id: "variant_1",
            title: "Default",
            sku: "1-00-12-0",
            metadata: { qbd_list_id: "QB-VARIANT" },
          },
        ],
      },
      {
        MedusaProduct: {
          FutureOrderEligible: false,
          ReplenishmentLeadDays: 21,
          SafetyStockQuantity: 2,
          UnavailableMessage: "Temporarily unavailable.",
          ExpectedAvailabilityCopy: "Expected in 3 weeks.",
          SubstitutionGroup: "ground-beef",
          AlternativeVariantIds: "variant_alt_1",
          Variants: [
            {
              VariantId: "variant_1",
              FutureOrderEligible: true,
              ReplenishmentLeadDays: 10,
              SafetyStockQuantity: 1,
              AlternativeVariantIds: "variant_alt_2",
            },
          ],
        },
      }
    );

    expect(payload.MedusaProduct).toMatchObject({
      FutureOrderEligible: false,
      ReplenishmentLeadDays: 21,
      SafetyStockQuantity: 2,
      UnavailableMessage: "Temporarily unavailable.",
      ExpectedAvailabilityCopy: "Expected in 3 weeks.",
      SubstitutionGroup: "ground-beef",
      AlternativeVariantIds: "variant_alt_1",
    });
    expect(payload.MedusaProduct.Variants[0]).toMatchObject({
      FutureOrderEligible: true,
      ReplenishmentLeadDays: 10,
      SafetyStockQuantity: 1,
      AlternativeVariantIds: "variant_alt_2",
    });
  });

  it("preserves existing Strapi customer copy when Medusa titles came from QuickBooks", () => {
    const payload = service().mapToStrapiPayload(
      {
        id: "prod_1",
        title: "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb.",
        description: "Accounting item description from QuickBooks.",
        handle: "ground-beef-75-25-10-lb-tube",
        status: "published",
        metadata: { qbd_list_id: "QB-PRODUCT" },
        variants: [
          {
            id: "variant_1",
            title: "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb.",
            sku: "10-15-03-1",
            metadata: { qbd_list_id: "QB-VARIANT" },
          },
        ],
      },
      {
        Title: "Ground Beef 75/25 - 10 lb Tube",
        MedusaProduct: {
          Title: "Ground Beef 75/25 - 10 lb Tube",
          Description: "Freshly ground beef packed in a convenient 10 lb tube.",
          ShortDescription: "A kitchen staple for burgers, meatballs, and chili.",
          Variants: [
            {
              VariantId: "variant_1",
              Title: "10 lb Tube",
            },
          ],
        },
      }
    );

    expect(payload.Title).toBe("Ground Beef 75/25 - 10 lb Tube");
    expect(payload.MedusaProduct.Title).toBe(
      "Ground Beef 75/25 - 10 lb Tube"
    );
    expect(payload.MedusaProduct.Description).toBe(
      "Freshly ground beef packed in a convenient 10 lb tube."
    );
    expect(payload.MedusaProduct.ShortDescription).toBe(
      "A kitchen staple for burgers, meatballs, and chili."
    );
    expect(payload.MedusaProduct.Variants[0]).toMatchObject({
      VariantId: "variant_1",
      Title: "10 lb Tube",
      QuickBooksListId: "QB-VARIANT",
      Sku: "10-15-03-1",
    });
  });

  it("lets Medusa metadata override preserved allocation policy fields", () => {
    const payload = service().mapToStrapiPayload(
      {
        id: "prod_1",
        title: "Ground Beef",
        description: "Ground beef",
        handle: "ground-beef",
        status: "published",
        metadata: {
          future_order_eligible: true,
          replenishment_lead_days: 14,
          safety_stock_quantity: 4,
        },
        variants: [],
      },
      {
        MedusaProduct: {
          FutureOrderEligible: false,
          ReplenishmentLeadDays: 21,
          SafetyStockQuantity: 2,
        },
      }
    );

    expect(payload.MedusaProduct).toMatchObject({
      FutureOrderEligible: true,
      ReplenishmentLeadDays: 14,
      SafetyStockQuantity: 4,
    });
  });

  it("refuses to update Strapi when the existing record cannot be read", async () => {
    const svc = service();
    const get = jest.fn().mockRejectedValue(new Error("Strapi unavailable"));
    const put = jest.fn();
    svc.client = { get, put };

    await expect(
      svc.updateProduct("strapi_doc_1", {
        id: "prod_1",
        title: "QuickBooks fallback title",
        description: "QuickBooks fallback description",
        handle: "quickbooks-fallback-title",
        status: "published",
        metadata: {},
        variants: [],
      })
    ).rejects.toThrow("Strapi unavailable");

    expect(put).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("refusing to update"),
      expect.any(Error)
    );
  });

  it("reads nested product state with Strapi 5 indexed populate params before updating", async () => {
    const svc = service();
    const get = jest.fn().mockResolvedValue({
      data: {
        data: {
          documentId: "strapi_doc_1",
          Title: "Customer-safe product title",
          MedusaProduct: {
            ProductId: "prod_1",
            Title: "Customer-safe product title",
            Description: "Customer-safe product description",
            Variants: [
              {
                VariantId: "variant_1",
                Title: "Customer-safe variant title",
                Sku: "1-00-12-0",
              },
            ],
            AlternativeProducts: [],
          },
        },
      },
    });
    const put = jest.fn().mockResolvedValue({
      data: { data: { documentId: "strapi_doc_1" } },
    });
    svc.client = { get, put };

    await svc.updateProduct("strapi_doc_1", {
      id: "prod_1",
      title: "QuickBooks product title",
      description: "QuickBooks product description",
      handle: "quickbooks-product-title",
      status: "published",
      metadata: { qbd_list_id: "QB-PRODUCT" },
      variants: [
        {
          id: "variant_1",
          title: "QuickBooks variant title",
          sku: "1-00-12-0",
          metadata: { qbd_list_id: "QB-VARIANT" },
        },
      ],
    });

    expect(get).toHaveBeenCalledWith("/api/products/strapi_doc_1", {
      params: {
        "populate[MedusaProduct][populate][0]": "Variants",
        "populate[MedusaProduct][populate][1]": "AlternativeProducts",
      },
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("does not delete Strapi products unless destructive sync is explicitly enabled", async () => {
    const svc = service();
    const del = jest.fn();
    svc.client = { delete: del };

    const response = await svc.deleteProduct("strapi_doc_1");

    expect(del).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("STRAPI_ALLOW_DESTRUCTIVE_SYNC=true")
    );
  });

  it("allows Strapi product deletion only behind the destructive sync switch", async () => {
    process.env.STRAPI_ALLOW_DESTRUCTIVE_SYNC = "true";
    const svc = service();
    const del = jest.fn().mockResolvedValue({ data: null, status: 200 });
    svc.client = { delete: del };

    await svc.deleteProduct("strapi_doc_1");

    expect(del).toHaveBeenCalledWith("/api/products/strapi_doc_1");
  });
});
