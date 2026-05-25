import StrapiModuleService from "../service";

const logger = {
  info: jest.fn(),
  error: jest.fn(),
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
});
