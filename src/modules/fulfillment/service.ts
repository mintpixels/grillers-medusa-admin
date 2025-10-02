// src/modules/grillers-fulfillment/service.ts
import {
  AbstractFulfillmentProviderService,
  Modules,
} from "@medusajs/framework/utils";
import type {
  Logger,
  CalculateShippingOptionPriceDTO,
  CreateShippingOptionDTO,
  FulfillmentItemDTO,
  FulfillmentOrderDTO,
  FulfillmentDTO,
  CreateFulfillmentResult,
  CalculatedShippingOptionPrice,
  FulfillmentOption,
} from "@medusajs/framework/types";

import StrapiModuleService from "../strapi/service";
import { STRAPI_MODULE } from "../strapi";

type InjectedDependencies = {
  logger: Logger;
};

type Options = {
  apiKey?: string;
  endpoint?: string;
};

export default class GrillersFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "grillers-fulfillment"; // => stored as fp_grillers_<id> in DB

  protected logger_: Logger;
  protected options_: Options;
  protected strapiSvc: any;

  // Example: your external shipper SDK/client
  protected client: {
    hasRates: (optionId: string) => Promise<boolean>;
    calculate: (data: Record<string, unknown>) => Promise<number>;
    create: (
      fulfillment: Partial<
        Omit<FulfillmentDTO, "provider_id" | "data" | "items">
      >,
      items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[]
    ) => Promise<Record<string, unknown>>;
    createReturn: (
      fulfillment: Record<string, unknown>
    ) => Promise<Record<string, unknown>>;
    cancel: (externalId: string) => Promise<void>;
    getDocuments: (
      externalId: string
    ) => Promise<Array<{ name: string; url: string }>>;
    getServices: () => Promise<
      Array<{ id: string; name: string; code: string }>
    >;
  };

  constructor(container: any, options: Options) {
    super();
    this.logger_ = container.logger;
    this.options_ = options;
    this.logger_.info("GrillersFulfillmentProviderService loaded");
    // this.strapiSvc = container.resolve(STRAPI_MODULE) as StrapiModuleService;

    // Initialize your third-party client here (SDK, REST wrapper, etc.)
    // For demo purposes, we mock the needed methods:
    this.client = {
      hasRates: async (optionId) => {
        this.logger_.info(`hasRates called for option ${optionId}`);
        return false;
        // if (optionId == "ground") return true;
        return false;
      },
      calculate: async () => 999, // cents
      create: async () => ({
        external_id: "SHIP-123",
        tracking_url: "https://track.example/SHIP-123",
      }),
      createReturn: async () => ({
        external_id: "RET-123",
        rma_label_url: "https://labels.example/RET-123.pdf",
      }),
      cancel: async () => {},
      getDocuments: async () => [
        { name: "label", url: "https://labels.example/SHIP-123.pdf" },
      ],
      getServices: async () => {
        return [
          {
            id: "pickup",
            name: "Pickup From Plant Premises in Atlanta, GA",
            code: "PICKUP",
          },
          {
            id: "atlanta",
            name: "Metro Atlanta Delivery",
            code: "ATLANTA_DELIVERY",
          },
          {
            id: "scheduled",
            name: "Scheduled Delivery",
            code: "SCHEDULED_DELIVERY",
          },
          {
            id: "ground",
            name: "Ground Estimated Shipping",
            code: "GROUND",
          },
          {
            id: "overnight",
            name: "Overnight Estimated Shipping",
            code: "OVERNIGHT",
          },
        ];
      },
    };
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    // assuming you have a client
    const services = await this.client.getServices();

    return services.map((service) => ({
      id: service.id,
      name: service.name,
      service_code: service.code,
      // can add other relevant data for the provider to later process the shipping option.
    }));
  }

  async validateFulfillmentData(
    optionData: any,
    data: any,
    context: any
  ): Promise<any> {
    // assuming your client retrieves an ID from the
    // third-party service
    const externalId = 123; //await this.client.getId();

    return {
      ...data,
      externalId,
    };
  }

  /**
   * Called when Admin creates a *calculated* shipping option.
   * Return false to block creation (no live rates available).
   */
  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    // Typically check carrier/rate availability based on option data
    const ok = await this.client.hasRates(String((data as any)?.id ?? ""));
    return ok;
  }

  /**
   * Calculates price for a shipping method (cart refresh or creation).
   */
  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    // Use "optionData" (from getFulfillmentOptions) + "data" (from validateFulfillmentData/front-end)
    // and any context (cart, from_location) to fetch a live rate.
    console.log("optionData1", optionData);
    console.log("data2", data);
    const amount = await this.client.calculate({
      ...optionData,
      ...data,
      ...context,
    });
    return {
      calculated_amount: amount,
      is_calculated_price_tax_inclusive: true,
    };
  }

  /**
   * Create an outbound fulfillment with your 3rd-party service.
   * Anything you return in `data` is persisted on the Fulfillment in Medusa.
   */
  async createFulfillment(
    data: Record<string, unknown>,
    items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const externalData = await this.client.create(fulfillment, items);

    // You can also return labels here as part of the result if available.
    return {
      data: {
        ...(fulfillment.data as object | undefined),
        ...externalData,
      },
      // labels: [{ tracking_number: "...", label_url: "...", ... }]
    };
  }

  /**
   * Create a return fulfillment (RMA label, etc.)
   */
  async createReturnFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    const externalData = await this.client.createReturn(fulfillment);
    return {
      data: { ...externalData },
      // labels: [{ label_url: externalData.rma_label_url }]
    };
  }

  /**
   * Cancel a fulfillment with your 3rd-party service.
   */
  async cancelFulfillment(data: Record<string, unknown>): Promise<any> {
    const { external_id } = (data || {}) as { external_id?: string };
    if (external_id) {
      await this.client.cancel(external_id);
    } else {
      this.logger_.warn(
        "[grillers] cancelFulfillment called without external_id"
      );
    }
  }

  /**
   * Return artifacts (labels, invoices, etc.) for a fulfillment.
   */
  // ...
  async getFulfillmentDocuments(data: any): Promise<never[]> {
    // assuming the client retrieves documents
    // from a third-party service
    return await this.client.getDocuments(data);
  }
}
