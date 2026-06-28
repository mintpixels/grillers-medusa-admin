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
  PAYMENT_WORKFLOW_INVOICE_AR,
  SYSTEM_PAYMENT_PROVIDER_ID,
  appendStaffAudit,
  ensureFinalizationForOrder,
  ensurePaymentSetup,
  metadataObject,
} from "../../../../../lib/catch-weight-finalization";
import { emitOpsAlert } from "../../../../../lib/ops-alert";
import { isOfflinePaymentApproved } from "../../../../../lib/gp-offline-payment";
import {
  evaluateCreditLimit,
  creditHoldMetadata,
} from "../../../../../lib/gp-credit-limit";

const PLACE_ORDER_PATH = "store/grillers/checkout/place-order";

const redactedErrorMessage = (message?: string | null) =>
  String(message || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(
      /\b(?:order|cart|pi|pm|py|pay|refund|re|fin|attempt|prod|variant|seti)_[A-Za-z0-9_]+/g,
      "[redacted-id]",
    )
    .slice(0, 300);

type PlaceOrderBody = {
  cart_id?: string;
  payment_method_id?: string;
  setup_intent_id?: string | null;
  consent_version?: string | null;
  consent_text?: string | null;
  // #283: "invoice" routes an approved B2B account to the no-card A/R path.
  payment_method?: string;
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

/**
 * #286 — sum the customer's OPEN invoice (A/R) balance: the totals of their other invoice_ar
 * orders that are neither cancelled nor already marked paid. Used to enforce the credit limit.
 */
async function computeOpenInvoiceBalance(
  req: MedusaRequest,
  customerId: string,
  excludeOrderId: string,
): Promise<number> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "total", "status", "metadata"],
    filters: { customer_id: customerId },
  });
  let sum = 0;
  for (const o of (data || []) as any[]) {
    if (!o || o.id === excludeOrderId) continue;
    const meta = metadataObject(o.metadata);
    if (meta.payment_workflow !== PAYMENT_WORKFLOW_INVOICE_AR) continue;
    if (o.status === "canceled" || meta.invoice_paid === true) continue;
    const total = typeof o.total === "number" ? o.total : Number(o.total) || 0;
    if (Number.isFinite(total) && total > 0) sum += total;
  }
  return sum;
}

/** #286 — the cart's current (estimated) total, used to evaluate the credit limit pre-completion. */
async function getCartTotal(
  req: MedusaRequest,
  cartId: string,
): Promise<number> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "cart",
    fields: ["id", "total"],
    filters: { id: cartId },
  });
  const total = (data?.[0] as any)?.total;
  // Throw (→ caller's fail-safe hold) if the total is missing rather than reading 0 and
  // under-holding a real order. A genuine $0 cart still returns a numeric 0.
  if (total === null || total === undefined) {
    throw new Error("Cart total unavailable for credit evaluation.");
  }
  const n = typeof total === "number" ? total : Number(total);
  if (!Number.isFinite(n)) {
    throw new Error("Cart total is not numeric.");
  }
  return n;
}

/**
 * #283 — place a no-card "pay by invoice" order for an approved B2B account.
 *
 * Mirrors the saved-card flow's completion (no-amount SYSTEM payment session → completeCart →
 * finalization for catch-weight packing) but carries NO Stripe card, NO final-charge consent,
 * and NO payment setup. The order is marked with payment_workflow = INVOICE_AR so the
 * pre-shipment card gate is skipped (#284) and the QB sync can route it to A/R (#285). The
 * caller has already verified the customer is approved.
 */
async function placeInvoiceOrder(
  req: MedusaRequest,
  res: MedusaResponse,
  ctx: { cartId: string; customer: any; staffTargetCustomerId?: string | null },
) {
  const { cartId, customer, staffTargetCustomerId } = ctx;
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
      return jsonError(res, 403, "This customer context does not match the cart.");
    }
  }

  const customerMeta = metadataObject(customer.metadata);
  const paymentTerms =
    typeof customerMeta.gp_payment_terms === "string"
      ? customerMeta.gp_payment_terms
      : "Net 10";

  // Invoice markers carried on the cart (copied to the order on completion) AND re-stamped on
  // the order. payment_workflow=INVOICE_AR keeps orderRequiresFinalCharge() false; the rest
  // drives QB A/R routing (#285).
  const invoiceFields: Record<string, any> = {
    payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR,
    payment_status: "invoice",
    gp_payment_method: "invoice",
    gp_payment_terms: paymentTerms,
    gp_credit_limit: customerMeta.gp_credit_limit ?? null,
    fulfillment_gate_status: "open_invoice",
  };

  // #286 (Codex P1): evaluate the credit limit BEFORE completing the cart, and stamp any hold
  // onto the CART metadata. Medusa copies cart metadata to the order on completion, so the order
  // is created already-held — a hold can never be lost in a post-completion failure window.
  let creditMeta: Record<string, any> = {};
  try {
    const [outstanding, cartTotal] = await Promise.all([
      computeOpenInvoiceBalance(req, customer.id, ""),
      getCartTotal(req, cartId),
    ]);
    const evaluation = evaluateCreditLimit({
      creditLimit: customerMeta.gp_credit_limit,
      outstanding,
      orderTotal: cartTotal,
    });
    if (evaluation.requiresSecondApproval) {
      creditMeta = {
        ...creditHoldMetadata(evaluation, new Date().toISOString()),
        fulfillment_hold: {
          held: true,
          reason: "credit_limit_exceeded",
          over_by: evaluation.overBy,
        },
      };
    }
  } catch {
    // Fail safe: if exposure can't be computed, hold for review rather than extend credit blindly.
    creditMeta = {
      gp_credit_hold: {
        held: true,
        reason: "credit_check_unavailable",
        placed_at: new Date().toISOString(),
      },
      fulfillment_hold: { held: true, reason: "credit_check_unavailable" },
    };
  }

  const checkoutMetadata = appendStaffAudit(
    { ...existingMetadata, ...invoiceFields, ...creditMeta },
    {
      action: "checkout_pay_by_invoice",
      status: "order_ready_invoice",
      customer_id: customer.id,
    },
  );

  await cartModule.updateCarts(cartId, {
    customer_id: customer.id,
    email: customer.email || existingCart.email,
    metadata: checkoutMetadata,
  });

  // A no-amount SYSTEM payment session is still required for completeCartWorkflow to produce an
  // order; it carries no Stripe data and authorizes no charge.
  const paymentCollection = await ensurePaymentCollection(req, cartId);
  await createPaymentSessionsWorkflow(req.scope).run({
    input: {
      payment_collection_id: paymentCollection.id,
      provider_id: SYSTEM_PAYMENT_PROVIDER_ID,
      customer_id: customer.id,
      data: { payment_workflow: PAYMENT_WORKFLOW_INVOICE_AR },
    },
  });

  const { errors, result } = await completeCartWorkflow(req.scope).run({
    input: { id: cartId },
    context: { transactionId: cartId },
    throwOnError: false,
  });

  if (errors?.[0]) {
    const message =
      errors[0].error?.message || "Could not place the order. Please try again.";
    await emitOpsAlert({
      alertKind: "place_order_error",
      severity: "page",
      path: PLACE_ORDER_PATH,
      title: "place-order (invoice) complete-cart 400",
      fingerprint: `place_order:invoice_complete_cart:${errors[0].error?.name || ""}`,
      meta: {
        cart_id: cartId,
        workflow_error: redactedErrorMessage(errors[0].error?.message),
      },
      logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER),
    });
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
    await emitOpsAlert({
      alertKind: "place_order_error",
      severity: "page",
      path: PLACE_ORDER_PATH,
      title: "place-order (invoice) order created but not retrievable",
      fingerprint: "place_order:invoice_order_created_not_retrievable",
      meta: { cart_id: cartId, order_id: result?.id },
      logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER),
    });
    return jsonError(res, 500, "Order was created but could not be retrieved.");
  }

  // Track catch-weight packing/weighing via a finalization row, but NO payment setup (no card).
  // The final weight is invoiced (Phase 4) rather than charged.
  const finalization = await ensureFinalizationForOrder(db, order);

  // creditMeta was computed pre-completion and is already on the order via the cart copy; we
  // re-stamp it here idempotently alongside the finalization fields.
  const metadata = {
    ...metadataObject(order.metadata),
    ...invoiceFields,
    ...creditMeta,
    catch_weight_status: "pending_pack",
    finalization_id: finalization.finalization.id,
    finalization_status: finalization.finalization.status,
    estimated_total: finalization.finalization.estimated_order_total,
  };

  await orderModule.updateOrders(order.id, { metadata });
  order.metadata = metadata;

  return res.status(200).json({ type: "order", order });
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.body || {}) as PlaceOrderBody;
  const cartId = body.cart_id;
  const paymentMethodId = body.payment_method_id;
  const wantsInvoice = body.payment_method === "invoice";

  if (!cartId) {
    return jsonError(res, 400, "Cart id is required.");
  }

  try {
    const { customer, staffTargetCustomerId } =
      await getPaymentContextCustomer(req);
    if (!customer) {
      return jsonError(res, 401, "You must be signed in to place this order.");
    }

    // #283: approved B2B accounts can place a no-card invoice order. Fail closed — a
    // non-approved customer asking to pay by invoice is rejected, never silently let through.
    if (wantsInvoice) {
      if (!isOfflinePaymentApproved((customer as any).metadata)) {
        return jsonError(
          res,
          403,
          "This account is not approved to pay by invoice.",
        );
      }
      return await placeInvoiceOrder(req, res, {
        cartId,
        customer,
        staffTargetCustomerId,
      });
    }

    if (!paymentMethodId) {
      return jsonError(res, 400, "A saved card is required.");
    }
    if (!body.consent_version || !body.consent_text) {
      return jsonError(res, 400, "Final charge consent is required.");
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
      // Distinct fingerprint from the outer 500 so a Stripe-decline storm
      // (complete-cart 400) never merges with an infra 500.
      await emitOpsAlert({
        alertKind: "place_order_error",
        severity: "page",
        path: PLACE_ORDER_PATH,
        title: "place-order complete-cart 400",
        fingerprint: `place_order:complete_cart:${errors[0].error?.name || ""}`,
        meta: {
          cart_id: cartId,
          workflow_error: redactedErrorMessage(errors[0].error?.message),
        },
        logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER),
      });
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
      // Worst case: complete-cart succeeded (order created) but we can't read
      // it back — money may be taken, order effectively lost. Distinct
      // fingerprint so this never merges with the generic 500 or the 400.
      await emitOpsAlert({
        alertKind: "place_order_error",
        severity: "page",
        path: PLACE_ORDER_PATH,
        title: "place-order order created but not retrievable",
        fingerprint: "place_order:order_created_not_retrievable",
        meta: {
          cart_id: cartId,
          order_id: result?.id,
        },
        logger: req.scope.resolve(ContainerRegistrationKeys.LOGGER),
      });
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
    const err = error as { name?: string; message?: string } | undefined;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[catch-weight-checkout] ${message}`);
    // NEVER include raw card/token/PII or the full payment payload — only
    // cart_id + error name/message (sliced).
    await emitOpsAlert({
      alertKind: "place_order_error",
      severity: "page",
      path: PLACE_ORDER_PATH,
      title: "place-order 500: " + (err?.name || "error"),
      meta: {
        cart_id: cartId,
        error_name: err?.name,
        error_message: redactedErrorMessage(err?.message),
      },
      logger,
    });
    res.status(500).json({
      message: "Could not place the order. Please try again.",
    });
  }
};
