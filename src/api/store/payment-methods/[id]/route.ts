import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  DEFAULT_PAYMENT_METHOD_METADATA_KEY,
  assertPaymentMethodBelongsToCustomer,
  getAuthenticatedCustomer,
  handleRouteError,
  jsonError,
  setCustomerDefaultPaymentMethod,
  stripeFormRequest,
} from "../utils";

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
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

    await stripeFormRequest(`/v1/payment_methods/${paymentMethodId}/detach`, {});

    if (customer.metadata?.[DEFAULT_PAYMENT_METHOD_METADATA_KEY] === paymentMethodId) {
      await setCustomerDefaultPaymentMethod(req, customer);
    }

    res.json({ success: true });
  } catch (error) {
    handleRouteError(req, res, error, "Could not delete payment method.");
  }
};
