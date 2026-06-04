import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import {
  ContainerRegistrationKeys,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import {
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
} from "@medusajs/core-flows";
import {
  STRIPE_PROVIDER_ID,
  assertPaymentMethodBelongsToCustomer,
  getPaymentContextCustomer,
  getStripeAccountHolder,
  getStripeCustomerId,
  jsonError,
} from "../../../payment-methods/utils";
import {
  PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
  SYSTEM_PAYMENT_PROVIDER_ID,
  appendStaffAudit,
  ensureFinalizationForOrder,
  ensurePaymentSetup,
  metadataObject,
} from "../../../../../lib/catch-weight-finalization";

type PlaceOrderBody = {
  cart_id?: string;
  payment_method_id?: string;
  setup_intent_id?: string | null;
  consent_version?: string | null;
  consent_text?: string | null;
};

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "customer_id",
  "cart_id",
  "total",
  "subtotal",
  "item_subtotal",
  "shipping_total",
  "tax_total",
  "discount_total",
  "raw_total",
  "raw_subtotal",
  "raw_item_subtotal",
  "raw_shipping_total",
  "raw_tax_total",
  "raw_discount_total",
  "metadata",
  "items.id",
  "items.title",
  "items.subtitle",
  "items.product_id",
  "items.variant_id",
  "items.variant_sku",
  "items.quantity",
  "items.unit_price",
  "items.subtotal",
  "items.tax_total",
  "items.total",
  "items.raw_quantity",
  "items.raw_unit_price",
  "items.raw_subtotal",
  "items.raw_tax_total",
  "items.raw_total",
  "items.metadata",
  "items.detail.quantity",
  "items.detail.raw_quantity",
  "items.detail.unit_price",
  "items.detail.raw_unit_price",
  "items.detail.subtotal",
  "items.detail.raw_subtotal",
  "items.detail.tax_total",
  "items.detail.raw_tax_total",
  "items.detail.total",
  "items.detail.raw_total",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.metadata",
  "items.variant.product.id",
  "items.variant.product.metadata",
];

async function verifyStripeSetupIntent(input: {
  setupIntentId?: string | null;
  paymentMethodId: string;
}) {
  if (!input.setupIntentId) return;
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error("Stripe secret key is not configured.");
  }

  const response = await fetch(
    `https://api.stripe.com/v1/setup_intents/${encodeURIComponent(
      input.setupIntentId,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  );
  const json = await response.json();

  if (!response.ok) {
    throw new Error(
      json?.error?.message || "Could not verify saved card setup.",
    );
  }

  if (json.status !== "succeeded") {
    throw new Error("Card setup has not succeeded yet.");
  }

  if (json.payment_method !== input.paymentMethodId) {
    throw new Error(
      "Saved card setup does not match the selected payment method.",
    );
  }
}

async function ensurePaymentCollection(req: MedusaRequest, cartId: string) {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const fetchCollection = async () => {
    const [relation] = await remoteQuery(
      remoteQueryObjectFromString({
        entryPoint: "cart_payment_collection",
        variables: { filters: { cart_id: cartId } },
        fields: [
          "payment_collection.id",
          "payment_collection.payment_sessions.id",
          "payment_collection.payment_sessions.provider_id",
        ],
      }),
    );
    return relation?.payment_collection || null;
  };

  let paymentCollection = await fetchCollection();

  if (!paymentCollection) {
    await createPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id: cartId },
    });
    paymentCollection = await fetchCollection();
  }

  if (!paymentCollection?.id) {
    throw new Error("Could not create a payment collection for this cart.");
  }

  return paymentCollection;
}

async function retrieveOrder(req: MedusaRequest, orderId: string) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id: orderId },
  });
  return data?.[0] || null;
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body || {}) as PlaceOrderBody;
  const cartId = body.cart_id;
  const paymentMethodId = body.payment_method_id;

  if (!cartId) {
    return jsonError(res, 400, "Cart id is required.");
  }
  if (!paymentMethodId) {
    return jsonError(res, 400, "A saved card is required.");
  }
  if (!body.consent_version || !body.consent_text) {
    return jsonError(res, 400, "Final charge consent is required.");
  }

  try {
    const { customer, staffTargetCustomerId } =
      await getPaymentContextCustomer(req);
    if (!customer) {
      return jsonError(res, 401, "You must be signed in to place this order.");
    }

    await verifyStripeSetupIntent({
      setupIntentId: body.setup_intent_id,
      paymentMethodId,
    });

    const belongsToCustomer = await assertPaymentMethodBelongsToCustomer(
      req,
      customer,
      paymentMethodId,
    );

    if (!belongsToCustomer) {
      return jsonError(res, 400, "The selected card is not available.");
    }

    const accountHolder = getStripeAccountHolder(customer);
    const cartModule = req.scope.resolve(Modules.CART);
    const orderModule = req.scope.resolve(Modules.ORDER);
    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const existingCart = await cartModule.retrieveCart(cartId, {
      select: ["id", "email", "customer_id", "metadata"],
    });
    const existingMetadata = metadataObject(existingCart?.metadata);

    if (staffTargetCustomerId) {
      const metadataTarget =
        existingMetadata.staff_target_customer_id ||
        existingMetadata.staff_selected_customer_id;

      if (metadataTarget && metadataTarget !== customer.id) {
        return jsonError(
          res,
          403,
          "This customer context does not match the cart.",
        );
      }
    }

    const checkoutMetadata: Record<string, any> = appendStaffAudit(
      {
        ...existingMetadata,
        payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
        payment_setup_status: "saved",
        final_charge_status: "not_started",
        catch_weight_status: "pending_pack",
        fulfillment_gate_status: "blocked_until_final_charge",
        stripe_provider_id: STRIPE_PROVIDER_ID,
        stripe_payment_method_id: paymentMethodId,
        stripe_account_holder_id: accountHolder?.id || null,
        setup_intent_id: body.setup_intent_id || null,
        final_charge_consent_version: body.consent_version,
        final_charge_consent_text: body.consent_text,
        final_charge_consented_at: new Date().toISOString(),
      },
      {
        action: "checkout_saved_card_for_final_charge",
        status: "order_ready_for_no_amount_completion",
        customer_id: customer.id,
      },
    );

    await cartModule.updateCarts(cartId, {
      customer_id: customer.id,
      email: customer.email || existingCart.email,
      metadata: checkoutMetadata,
    });

    const paymentCollection = await ensurePaymentCollection(req, cartId);

    await createPaymentSessionsWorkflow(req.scope).run({
      input: {
        payment_collection_id: paymentCollection.id,
        provider_id: SYSTEM_PAYMENT_PROVIDER_ID,
        customer_id: customer.id,
        data: {
          payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
          stripe_payment_method_id: paymentMethodId,
          setup_intent_id: body.setup_intent_id || null,
          final_charge_consent_version: body.consent_version,
        },
      },
    });

    const { errors, result } = await completeCartWorkflow(req.scope).run({
      input: { id: cartId },
      context: { transactionId: cartId },
      throwOnError: false,
    });

    if (errors?.[0]) {
      const message =
        errors[0].error?.message ||
        "Could not place the order. Please try again.";
      return res.status(400).json({
        type: "cart",
        error: {
          message,
          name: errors[0].error?.name,
          type: errors[0].error?.type,
        },
      });
    }

    const order = await retrieveOrder(req, result.id);
    if (!order) {
      return jsonError(
        res,
        500,
        "Order was created but could not be retrieved.",
      );
    }

    const finalization = await ensureFinalizationForOrder(db, order);
    await ensurePaymentSetup(db, {
      order,
      cartId,
      customerId: customer.id,
      customerEmail: customer.email || order.email || null,
      stripeCustomerId: accountHolder
        ? getStripeCustomerId(accountHolder)
        : null,
      stripePaymentMethodId: paymentMethodId,
      setupIntentId: body.setup_intent_id || null,
      accountHolderId: accountHolder?.id || null,
      consentVersion: body.consent_version,
      consentText: body.consent_text,
      consentedAt:
        checkoutMetadata.final_charge_consented_at || new Date().toISOString(),
    });

    const metadata = {
      ...metadataObject(order.metadata),
      payment_workflow: PAYMENT_WORKFLOW_SETUP_THEN_FINAL_CHARGE,
      payment_setup_status: "saved",
      catch_weight_status: "pending_pack",
      finalization_id: finalization.finalization.id,
      finalization_status: finalization.finalization.status,
      final_charge_status: "not_started",
      fulfillment_gate_status: "blocked_until_final_charge",
      estimated_total: finalization.finalization.estimated_order_total,
    };

    await orderModule.updateOrders(order.id, { metadata });
    order.metadata = metadata;

    res.status(200).json({
      type: "order",
      order,
    });
  } catch (error) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER);
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[catch-weight-checkout] ${message}`);
    res.status(500).json({
      message: "Could not place the order. Please try again.",
    });
  }
};
