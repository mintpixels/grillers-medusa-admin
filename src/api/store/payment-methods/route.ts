import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  getAuthenticatedCustomer,
  handleRouteError,
  jsonError,
  listStripePaymentMethods,
} from "./utils";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const customer = await getAuthenticatedCustomer(req);
    if (!customer) {
      return jsonError(res, 401, "You must be signed in to manage payment methods.");
    }

    const paymentMethods = await listStripePaymentMethods(req, customer);
    res.json({ payment_methods: paymentMethods });
  } catch (error) {
    handleRouteError(req, res, error, "Could not load payment methods.");
  }
};
