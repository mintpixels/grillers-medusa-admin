import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { Modules } from "@medusajs/framework/utils";
import {
  STRIPE_PROVIDER_ID,
  getAuthenticatedCustomer,
  getOrCreateStripeAccountHolder,
  handleRouteError,
  jsonError,
} from "../utils";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const customer = await getAuthenticatedCustomer(req);
    if (!customer) {
      return jsonError(res, 401, "You must be signed in to add a card.");
    }

    const accountHolder = await getOrCreateStripeAccountHolder(req, customer);
    const paymentModule = req.scope.resolve(Modules.PAYMENT) as any;

    const setupIntent = await paymentModule.createPaymentMethods({
      provider_id: STRIPE_PROVIDER_ID,
      data: {
        payment_method_types: ["card"],
        usage: "off_session",
      },
      context: {
        account_holder: accountHolder,
        customer,
      },
    });

    const clientSecret = setupIntent?.data?.client_secret;
    if (!clientSecret) {
      return jsonError(res, 500, "Could not start a card setup. Please try again.");
    }

    res.json({
      client_secret: clientSecret,
      account_holder_id: accountHolder.id,
    });
  } catch (error) {
    handleRouteError(req, res, error, "Could not start a card setup. Please try again.");
  }
};
