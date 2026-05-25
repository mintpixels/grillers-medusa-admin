import axios, { AxiosInstance, AxiosResponse } from "axios";
import { Logger, ConfigModule } from "@medusajs/framework/types";
import { getPricesForVariant } from "./utils/get-product-price";
import { StoreProduct, StoreProductVariant } from "@medusajs/types";

export type StrapiModuleOptions = {
  strapiUrl: string;
  strapiToken: string;
};

const QUICKBOOKS_LIST_ID_KEYS = [
  "qbd_list_id",
  "qbdListId",
  "quickbooks_list_id",
  "quickbooksListId",
  "qb_list_id",
  "qbListId",
  "qbd_item_list_id",
  "qbdItemListId",
  "quickbooks_item_list_id",
  "quickbooksItemListId",
  "qb_item_list_id",
  "qbItemListId",
  "QuickBooksListId",
  "ListID",
];

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function quickBooksListIdFromMetadata(metadata: unknown): string | undefined {
  const record = objectRecord(metadata);

  for (const key of QUICKBOOKS_LIST_ID_KEYS) {
    const value = textValue(record[key]);
    if (value) {
      return value;
    }
  }

  for (const namespace of ["qbd", "quickbooks", "qb"]) {
    const nested = objectRecord(record[namespace]);
    const value =
      textValue(nested.list_id) ||
      textValue(nested.item_list_id) ||
      textValue(nested.item_id);

    if (value) {
      return value;
    }
  }

  return undefined;
}

export default class StrapiModuleService {
  private client: AxiosInstance;
  private logger: Logger;

  constructor(
    { logger }: { logger: Logger; configModule?: ConfigModule },
    options: StrapiModuleOptions
  ) {
    this.logger = logger;
    this.client = axios.create({
      baseURL: options.strapiUrl,
      headers: {
        Authorization: `Bearer ${options.strapiToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Query Strapi for a product by its Medusa ID
   */
  public async findProductByMedusaId(medusaId: string) {
    try {
      const response: AxiosResponse<any> = await this.client.get(
        "/api/products",
        {
          params: {
            "filters[medusa_product_id][$eq]": medusaId,
            "pagination[limit]": 1,
          },
        }
      );

      const data = response.data?.data;
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
      this.logger.error(
        `Strapi: failed to find product (Medusa ID: ${medusaId})`,
        error
      );
      throw error;
    }
  }

  /**
   * Create a new Strapi product entry
   */
  public async createProduct(product: StoreProduct) {
    this.logger.info(`Strapi: creating product for Medusa ID ${product.id}`);

    try {
      const payload = this.mapToStrapiPayload(product);
      const response: AxiosResponse<any> = await this.client.post(
        `/api/products`,
        {
          data: payload,
        }
      );

      return response.data.data;
    } catch (error) {
      this.logger.error(
        `Strapi: error creating product (Medusa ID: ${product.id})`,
        error
      );
      throw error;
    }
  }

  /**
   * Update an existing Strapi product entry
   */
  public async updateProduct(strapiId: string, product: StoreProduct) {
    this.logger.info(
      `Strapi: updating product ${strapiId} (Medusa ID ${product.id})`
    );

    try {
      const payload = this.mapToStrapiPayload(product);
      const response: AxiosResponse<any> = await this.client.put(
        `/api/products/${strapiId}`,
        {
          data: payload,
        }
      );

      return response.data.data;
    } catch (error) {
      this.logger.error(
        `Strapi: error updating product ${strapiId} (Medusa ID: ${product.id})`,
        error
      );
      throw error;
    }
  }

  /**
   * Delete a Strapi product entry by ID
   */
  public async deleteProduct(strapiId: string): Promise<AxiosResponse<null>> {
    this.logger.info(`Strapi: deleting product ${strapiId}`);

    try {
      return await this.client.delete(`/api/products/${strapiId}`);
    } catch (error) {
      this.logger.error(`Strapi: error deleting product ${strapiId}`, error);
      throw error;
    }
  }

  /**
   * Query Strapi for available shipping zones
   */
  public async getShippingZones(medusaId: string) {
    try {
      const response: AxiosResponse<any> = await this.client.get(
        "/api/shipping-zones",
        {}
      );

      const data = response.data?.data;
      return Array.isArray(data) && data.length > 0 ? data[0] : null;
    } catch (error) {
      this.logger.error(
        `Strapi: failed to find product (Medusa ID: ${medusaId})`,
        error
      );
      throw error;
    }
  }

  /**
   * Convert a Medusa product into the shape expected by Strapi
   */
  private mapToStrapiPayload(product: StoreProduct) {
    try {
      const productQuickBooksListId = quickBooksListIdFromMetadata(
        product.metadata
      );

      return {
        medusa_product_id: product.id,
        Title: product.title,
        MedusaProduct: {
          ProductId: product.id,
          ...(productQuickBooksListId
            ? { QuickBooksListId: productQuickBooksListId }
            : {}),
          Title: product.title,
          Description: product.description,
          Handle: product.handle,
          Status: product.status,
          Variants:
            product.variants?.map((variant: StoreProductVariant) => {
              const price = getPricesForVariant(variant) || null;
              const variantQuickBooksListId =
                quickBooksListIdFromMetadata(variant.metadata) ||
                productQuickBooksListId;

              return {
                VariantId: variant.id,
                ...(variantQuickBooksListId
                  ? { QuickBooksListId: variantQuickBooksListId }
                  : {}),
                Title: variant.title,
                Price: {
                  CalculatedPriceNumber: price?.calculated_price_number ?? 0,
                  OriginalPriceNumber: price?.original_price_number ?? 0,
                },
                Sku: variant.sku,
              };
            }) ?? [],
        },
      };
    } catch (error) {
      this.logger.error(
        `Strapi: error mapping payload for Medusa ID ${product.id}`,
        error
      );
      throw new Error(
        `Failed to map Medusa product ${product.id} to Strapi payload: ${
          (error as Error).message
        }`
      );
    }
  }
}
