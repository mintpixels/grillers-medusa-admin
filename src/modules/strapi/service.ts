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

const WAITLIST_ENABLED_KEYS = [
  "waitlist_enabled",
  "waitlistEnabled",
  "WaitlistEnabled",
];

const AVAILABILITY_LIFECYCLE_KEYS = [
  "availability_lifecycle",
  "availabilityLifecycle",
  "AvailabilityLifecycle",
];

const VALID_AVAILABILITY_LIFECYCLES = new Set([
  "active",
  "seasonal_inactive",
  "discontinued",
  "internal_only",
]);

const FUTURE_ORDER_ELIGIBLE_KEYS = [
  "future_order_eligible",
  "futureOrderEligible",
  "FutureOrderEligible",
];

const REPLENISHMENT_LEAD_DAYS_KEYS = [
  "replenishment_lead_days",
  "replenishmentLeadDays",
  "ReplenishmentLeadDays",
];

const SAFETY_STOCK_QUANTITY_KEYS = [
  "safety_stock_quantity",
  "safetyStockQuantity",
  "SafetyStockQuantity",
];

const UNAVAILABLE_MESSAGE_KEYS = [
  "unavailable_message",
  "unavailableMessage",
  "UnavailableMessage",
];

const EXPECTED_AVAILABILITY_COPY_KEYS = [
  "expected_availability_copy",
  "expectedAvailabilityCopy",
  "ExpectedAvailabilityCopy",
];

const SUBSTITUTION_GROUP_KEYS = [
  "substitution_group",
  "substitutionGroup",
  "SubstitutionGroup",
];

const ALTERNATIVE_VARIANT_IDS_KEYS = [
  "alternative_variant_ids",
  "alternativeVariantIds",
  "AlternativeVariantIds",
];

const PRODUCT_POLICY_FIELDS = [
  "FutureOrderEligible",
  "ReplenishmentLeadDays",
  "SafetyStockQuantity",
  "UnavailableMessage",
  "ExpectedAvailabilityCopy",
  "SubstitutionGroup",
  "AlternativeVariantIds",
  "AlternativeProducts",
];

const VARIANT_POLICY_FIELDS = [
  "FutureOrderEligible",
  "ReplenishmentLeadDays",
  "SafetyStockQuantity",
  "UnavailableMessage",
  "ExpectedAvailabilityCopy",
  "SubstitutionGroup",
  "AlternativeVariantIds",
];

const PRODUCT_CUSTOMER_COPY_FIELDS = [
  "Title",
  "Description",
  "ShortDescription",
];

const VARIANT_CUSTOMER_COPY_FIELDS = ["Title"];

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

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "n"].includes(normalized)) {
      return false;
    }
  }

  return undefined;
}

function booleanFromMetadata(
  metadata: unknown,
  keys: string[]
): boolean | undefined {
  const record = objectRecord(metadata);

  for (const key of keys) {
    const value = booleanValue(record[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function numberFromMetadata(
  metadata: unknown,
  keys: string[]
): number | undefined {
  const record = objectRecord(metadata);

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function textFromMetadata(
  metadata: unknown,
  keys: string[]
): string | undefined {
  const record = objectRecord(metadata);

  for (const key of keys) {
    const value = textValue(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function availabilityLifecycleFromMetadata(
  metadata: unknown
): string | undefined {
  const record = objectRecord(metadata);

  for (const key of AVAILABILITY_LIFECYCLE_KEYS) {
    const value = textValue(record[key])?.toLowerCase();
    if (value && VALID_AVAILABILITY_LIFECYCLES.has(value)) {
      return value;
    }
  }

  return undefined;
}

function strapiFields(entry: any): Record<string, unknown> {
  const attributes = objectRecord(entry?.attributes);
  return Object.keys(attributes).length ? attributes : objectRecord(entry);
}

function existingMedusaProduct(entry: any): Record<string, unknown> {
  return objectRecord(strapiFields(entry).MedusaProduct);
}

function existingVariantById(
  existingProduct: Record<string, unknown>,
  variantId: string
): Record<string, unknown> {
  const variants = Array.isArray(existingProduct.Variants)
    ? existingProduct.Variants
    : [];
  return (
    variants.find(
      (variant) => objectRecord(variant).VariantId === variantId
    ) || {}
  ) as Record<string, unknown>;
}

function preserveExistingFields(
  existing: Record<string, unknown>,
  fieldNames: string[]
): Record<string, unknown> {
  return fieldNames.reduce((acc, field) => {
    if (existing[field] !== undefined && existing[field] !== null) {
      acc[field] = existing[field];
    }
    return acc;
  }, {} as Record<string, unknown>);
}

function existingOrFallback<T>(
  existing: Record<string, unknown>,
  fieldName: string,
  fallback: T
): T | unknown {
  return existing[fieldName] !== undefined && existing[fieldName] !== null
    ? existing[fieldName]
    : fallback;
}

function metadataPolicyFields(
  metadata: unknown
): Record<string, unknown> {
  const futureOrderEligible = booleanFromMetadata(
    metadata,
    FUTURE_ORDER_ELIGIBLE_KEYS
  );
  const replenishmentLeadDays = numberFromMetadata(
    metadata,
    REPLENISHMENT_LEAD_DAYS_KEYS
  );
  const safetyStockQuantity = numberFromMetadata(
    metadata,
    SAFETY_STOCK_QUANTITY_KEYS
  );
  const unavailableMessage = textFromMetadata(metadata, UNAVAILABLE_MESSAGE_KEYS);
  const expectedAvailabilityCopy = textFromMetadata(
    metadata,
    EXPECTED_AVAILABILITY_COPY_KEYS
  );
  const substitutionGroup = textFromMetadata(metadata, SUBSTITUTION_GROUP_KEYS);
  const alternativeVariantIds = textFromMetadata(
    metadata,
    ALTERNATIVE_VARIANT_IDS_KEYS
  );

  return {
    ...(futureOrderEligible !== undefined
      ? { FutureOrderEligible: futureOrderEligible }
      : {}),
    ...(replenishmentLeadDays !== undefined
      ? { ReplenishmentLeadDays: replenishmentLeadDays }
      : {}),
    ...(safetyStockQuantity !== undefined
      ? { SafetyStockQuantity: safetyStockQuantity }
      : {}),
    ...(unavailableMessage ? { UnavailableMessage: unavailableMessage } : {}),
    ...(expectedAvailabilityCopy
      ? { ExpectedAvailabilityCopy: expectedAvailabilityCopy }
      : {}),
    ...(substitutionGroup ? { SubstitutionGroup: substitutionGroup } : {}),
    ...(alternativeVariantIds
      ? { AlternativeVariantIds: alternativeVariantIds }
      : {}),
  };
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
      const existing = await this.findProductById(strapiId);
      const payload = this.mapToStrapiPayload(product, existing);
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

  private async findProductById(strapiId: string) {
    try {
      const response: AxiosResponse<any> = await this.client.get(
        `/api/products/${strapiId}`,
        {
          params: {
            "populate[MedusaProduct][populate]": "Variants,AlternativeProducts",
          },
        }
      );

      return response.data?.data || null;
    } catch (error) {
      this.logger.warn(
        `Strapi: could not read existing product ${strapiId}; preserving only Medusa metadata fields`
      );
      return null;
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
  private mapToStrapiPayload(product: StoreProduct, existing?: any) {
    try {
      const existingProduct = existingMedusaProduct(existing);
      const productQuickBooksListId = quickBooksListIdFromMetadata(
        product.metadata
      );
      const productWaitlistEnabled = booleanFromMetadata(
        product.metadata,
        WAITLIST_ENABLED_KEYS
      );
      const productAvailabilityLifecycle = availabilityLifecycleFromMetadata(
        product.metadata
      );
      const productPolicyFields = {
        ...preserveExistingFields(existingProduct, PRODUCT_POLICY_FIELDS),
        ...metadataPolicyFields(product.metadata),
      };
      const productCustomerCopyFields = preserveExistingFields(
        existingProduct,
        PRODUCT_CUSTOMER_COPY_FIELDS
      );

      return {
        medusa_product_id: product.id,
        Title: existingOrFallback(strapiFields(existing), "Title", product.title),
        MedusaProduct: {
          ...existingProduct,
          ProductId: product.id,
          ...(productQuickBooksListId
            ? { QuickBooksListId: productQuickBooksListId }
            : {}),
          ...(productWaitlistEnabled !== undefined
            ? { WaitlistEnabled: productWaitlistEnabled }
            : {}),
          ...(productAvailabilityLifecycle
            ? { AvailabilityLifecycle: productAvailabilityLifecycle }
            : {}),
          ...productPolicyFields,
          Title: existingOrFallback(
            productCustomerCopyFields,
            "Title",
            product.title
          ),
          Description: existingOrFallback(
            productCustomerCopyFields,
            "Description",
            product.description
          ),
          ...("ShortDescription" in productCustomerCopyFields
            ? { ShortDescription: productCustomerCopyFields.ShortDescription }
            : {}),
          Handle: product.handle,
          Status: product.status,
          Variants:
            product.variants?.map((variant: StoreProductVariant) => {
              const price = getPricesForVariant(variant) || null;
              const variantQuickBooksListId =
                quickBooksListIdFromMetadata(variant.metadata) ||
                productQuickBooksListId;
              const variantWaitlistEnabled =
                booleanFromMetadata(variant.metadata, WAITLIST_ENABLED_KEYS) ??
                productWaitlistEnabled;
              const variantAvailabilityLifecycle =
                availabilityLifecycleFromMetadata(variant.metadata) ||
                productAvailabilityLifecycle;
              const existingVariant = existingVariantById(
                existingProduct,
                variant.id
              );
              const variantPolicyFields = {
                ...preserveExistingFields(existingVariant, VARIANT_POLICY_FIELDS),
                ...metadataPolicyFields(variant.metadata),
              };
              const variantCustomerCopyFields = preserveExistingFields(
                existingVariant,
                VARIANT_CUSTOMER_COPY_FIELDS
              );

              return {
                ...existingVariant,
                VariantId: variant.id,
                ...(variantQuickBooksListId
                  ? { QuickBooksListId: variantQuickBooksListId }
                  : {}),
                ...(variantWaitlistEnabled !== undefined
                  ? { WaitlistEnabled: variantWaitlistEnabled }
                  : {}),
                ...(variantAvailabilityLifecycle
                  ? { AvailabilityLifecycle: variantAvailabilityLifecycle }
                  : {}),
                ...variantPolicyFields,
                Title: existingOrFallback(
                  variantCustomerCopyFields,
                  "Title",
                  variant.title
                ),
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
