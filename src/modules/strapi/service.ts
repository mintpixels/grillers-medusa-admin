import axios, { AxiosInstance } from "axios";
import { Logger, ConfigModule } from "@medusajs/framework/types";

export type StrapiModuleOptions = {
  strapiUrl: string;
  strapiToken: string;
};

export default class StrapiModuleService {
  private client: AxiosInstance;
  private logger_: Logger;

  constructor(
    { logger }: { logger: Logger; configModule: ConfigModule },
    options: StrapiModuleOptions
  ) {
    this.logger_ = logger;
    this.client = axios.create({
      baseURL: options.strapiUrl,
      headers: {
        Authorization: `Bearer ${options.strapiToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  /** Find the Strapi entry whose medusa_product_id equals the given Medusa ID */
  async findProductByMedusaId(medusaId: string) {
    const res = await this.client.get("/api/products", {
      params: {
        "filters[medusa_product_id][$eq]": medusaId,
        "pagination[limit]": 1,
      },
    });
    const data = res.data?.data;
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  async createProduct(product: any) {
    this.logger_.info(`Strapi: creating product for Medusa ID ${product.id}`);

    try {
      const payload = this.transform(product);
      return await this.client.post(`/api/products`, {
        data: payload,
      });
    } catch (error) {
      this.logger_.error(`Strapi: creating product for (Medusa ID ${product.id})`, error);
    }
  }

  async updateProduct(strapiId: string, product: any) {
    this.logger_.info(`Strapi: updating product ${strapiId} (Medusa ID ${product.id})`);

    try {
      const payload = this.transform(product);
      return await this.client.put(`/api/products/${strapiId}`, {
        data: payload,
      });
    } catch (error) {
      this.logger_.error(`Strapi: updating product ${strapiId} (Medusa ID ${product.id})`, error);
    }
  }

  async deleteProduct(strapiId: string) {
    this.logger_.info(`Strapi: deleting product ${strapiId}`);
    try {
      return await this.client.delete(`/api/products/${strapiId}`);
    } catch (error) {
      this.logger_.error(`Strapi: deleting product ${strapiId}`, error);
    }
  }

  /** Map Medusa product fields → Strapi fields */
  private transform(product: any) {
    return {
      medusa_product_id: product.id,
      Title: product.title,
    };
  }
}
