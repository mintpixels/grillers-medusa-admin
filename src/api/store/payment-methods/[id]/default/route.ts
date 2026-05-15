import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  assertPaymentMethodBelongsToCustomer,
  getAuthenticatedCustomer,
  getStripeAccountHolder,
  getStripeCustomerId,
  handleRouteError,
  jsonError,
  setCustomerDefaultPaymentMethod,
  stripeFormRequest,
} from "../../utils";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const customer = await getAuthenticatedCustomer(req);
    if (!customer) {
      return jsonError(res, 401, "You must be signed in to manage payment methods.");
    }

    const paymentMethodId = req.params.id;
    if (!paymentMethodId) {
      return jsonError(res, 400, "Payment method id is required.");
    }

    const belongsToCustomer = await assertPaymentMethodBelongsToCustomer(
      req,
      customer,
      paymentMethodId
    );
    if (!belongsToCustomer) {
      return jsonError(res, 404, "Payment method not found.");
    }

    const accountHolder = getStripeAccountHolder(customer);
    const stripeCustomerId = accountHolder ? getStripeCustomerId(accountHolder) : null;
    if (stripeCustomerId) {
      await stripeFormRequest(`/v1/customers/${stripeCustomerId}`, {
        "invoice_settings[default_payment_method]": paymentMethodId,
      });
    }

    await setCustomerDefaultPaymentMethod(req, customer, paymentMethodId);
    res.json({ success: true });
  } catch (error) {
    handleRouteError(req, res, error, "Could not set default payment method.");
  }
};
