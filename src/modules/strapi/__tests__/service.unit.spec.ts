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
});
