import {
  authenticate,
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  finalChargeSucceeded,
  orderRequiresFinalCharge,
} from "../lib/catch-weight-finalization"
import {
  isDestinationServiceable,
  resolveServiceCodeFromMethod,
  ZIP_RESTRICTED_SERVICE_CODES,
} from "../modules/fulfillment/serviceability"
import { emitOpsAlert, type OpsAlertSeverity } from "../lib/ops-alert"
import { opsErrorHandler } from "./middlewares/ops-error-handler"

const MIDDLEWARES_PATH = "src/api/middlewares.ts"

// Fail-open guards stay fail-open: they emit an ops alert AND continue. The
// consumer's dedup window absorbs hot-path volume, so no extra throttling here.
// NEVER include PII — only the guard's alertKind + the error message (sliced).
function emitGuardFailureAlert(input: {
  logger: Pick<import("@medusajs/framework/types").Logger, "warn" | "error">
  alertKind: string
  severity: OpsAlertSeverity
  title: string
  error: unknown
}) {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error)
  void emitOpsAlert({
    alertKind: input.alertKind,
    severity: input.severity,
    path: MIDDLEWARES_PATH,
    title: input.title,
    meta: { error_message: message.slice(0, 300) },
    logger: input.logger,
  })
}

const INTERNAL_RAW_MATERIAL_SKU = /^RM-/i

function isInternalRawMaterialSku(sku: unknown) {
  return (
    typeof sku === "string" && INTERNAL_RAW_MATERIAL_SKU.test(sku.trim())
  )
}

async function blockInternalRawMaterialLineItems(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const body = (req.body || {}) as { variant_id?: string }
  const variantId = body.variant_id

  if (!variantId) {
    return next()
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "product_variant",
      fields: ["id", "sku"],
      filters: { id: variantId },
    })
    const variant = data?.[0]

    if (isInternalRawMaterialSku(variant?.sku)) {
      res.status(400).json({
        type: "invalid_request",
        message: "This item is not available for online ordering.",
      })
      return
    }
  } catch (error) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`[store-cart] RM line guard lookup failed: ${message}`)
    emitGuardFailureAlert({
      logger,
      alertKind: "mw_rm_guard_failed",
      severity: "warn",
      title: "middleware: RM line-item guard lookup failed",
      error,
    })
  }

  return next()
}

async function blockFulfillmentBeforeFinalCharge(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const orderId =
    req.params.id ||
    (req.body as Record<string, any> | undefined)?.order_id ||
    (req.body as Record<string, any> | undefined)?.order?.id

  if (!orderId || typeof orderId !== "string") {
    return next()
  }

  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "metadata"],
      filters: { id: orderId },
    })
    const order = data?.[0]

    if (order && orderRequiresFinalCharge(order) && !finalChargeSucceeded(order)) {
      res.status(409).json({
        type: "payment_required",
        message:
          "This catch-weight order cannot be fulfilled until the final pre-shipment card charge succeeds.",
      })
      return
    }
  } catch (error) {
    const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`[catch-weight-finalization] fulfillment gate lookup failed: ${message}`)
    // Page: a fulfillment gate that fails open could let a catch-weight order
    // slip through BEFORE the final pre-shipment charge — direct money risk.
    emitGuardFailureAlert({
      logger,
      alertKind: "mw_fulfillment_gate_failed",
      severity: "page",
      title: "middleware: fulfillment gate lookup failed (failed open)",
      error,
    })
  }

  return next()
}

// LAYER 3 (don't offer unserviceable options): on GET /store/shipping-options,
// strip any zip/city-restricted option (Metro Atlanta Delivery / Scheduled
// Delivery) that can't serve the cart's ship-to address, so the storefront never
// presents an option that would later fail pricing.
//
// Approach: wrap res.json to post-process the body the CORE handler produces.
// We deliberately do NOT reimplement the core route — we just filter its output.
// This is robust to Medusa version changes in how options are built/priced.
//
// Fail open: if we can't resolve the cart/address, or any lookup throws, we
// return all options unfiltered. Non-restricted options always pass.
async function filterUnserviceableShippingOptions(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  const cartId =
    (req.query?.cart_id as string | undefined) ||
    ((req as any).filterableFields?.cart_id as string | undefined)

  // No cart context -> can't determine a destination -> don't filter.
  if (!cartId || typeof cartId !== "string") {
    return next()
  }

  // Resolve the cart's shipping address up front; if we can't, fail open by
  // leaving res.json untouched.
  let shippingAddress:
    | { postal_code?: string | null; city?: string | null; province?: string | null }
    | null = null
  try {
    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "shipping_address.postal_code",
        "shipping_address.city",
        "shipping_address.province",
      ],
      filters: { id: cartId },
    })
    shippingAddress = (data?.[0] as any)?.shipping_address || null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[shipping-options-filter] cart ${cartId} address lookup failed (${message}); returning all options`
    )
    emitGuardFailureAlert({
      logger,
      alertKind: "mw_shipping_options_filter_failed",
      severity: "warn",
      title: "middleware: shipping-options filter address lookup failed",
      error,
    })
    return next()
  }

  // No address yet -> nothing to restrict against -> fail open.
  if (!shippingAddress) {
    return next()
  }

  // Wrap res.json to post-process the body the CORE handler produces. The
  // override is sync (Express contract) but needs an async Strapi check, so it
  // buffers the result, resolves serviceability for the restricted options,
  // then emits via the original res.json. Any failure falls back to the
  // unfiltered body (fail open).
  const originalJson = res.json.bind(res)
  res.json = ((body: any) => {
    const options = Array.isArray(body?.shipping_options)
      ? body.shipping_options
      : null
    if (!options) {
      return originalJson(body)
    }

    // Only zip/city-restricted options need a Strapi check; everything else
    // always passes. If none are restricted, emit immediately (no await).
    const restricted = options.filter((option: any) => {
      const serviceCode = resolveServiceCodeFromMethod(option)
      return ZIP_RESTRICTED_SERVICE_CODES.has(serviceCode) && option?.id
    })
    if (restricted.length === 0) {
      return originalJson(body)
    }

    Promise.all(
      restricted.map(async (option: any) => {
        const serviceCode = resolveServiceCodeFromMethod(option)
        try {
          const ok = await isDestinationServiceable(serviceCode, shippingAddress)
          return [option.id as string, ok] as const
        } catch {
          // Fail open per option.
          return [option.id as string, true] as const
        }
      })
    )
      .then((entries) => {
        const verdicts = new Map<string, boolean>(entries)
        const filtered = options.filter((option: any) => {
          const serviceCode = resolveServiceCodeFromMethod(option)
          if (!ZIP_RESTRICTED_SERVICE_CODES.has(serviceCode)) return true
          // Default to serviceable (fail open) if a verdict is somehow missing.
          const verdict = option?.id ? verdicts.get(option.id) : undefined
          return verdict !== false
        })
        originalJson({ ...body, shipping_options: filtered })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(
          `[shipping-options-filter] serviceability check failed for cart ${cartId} (${message}); returning all options`
        )
        emitGuardFailureAlert({
          logger,
          alertKind: "mw_shipping_options_filter_failed",
          severity: "warn",
          title: "middleware: shipping-options serviceability check failed",
          error,
        })
        originalJson(body)
      })

    return res
  }) as typeof res.json

  return next()
}

// LAYER 1 (synchronous front-line self-heal): before any cart-mutation route
// that RE-PRICES the cart's selected shipping methods runs its core handler,
// remove any zip/city-restricted method (Metro Atlanta Delivery / Scheduled
// Delivery) whose service area no longer covers the cart's EFFECTIVE ship-to
// address. This makes the heal synchronous: the triggering request itself
// succeeds because refreshCartShippingMethodsWorkflow never sees the stale
// method and so never tries to re-price (and throw on) it.
//
// Two cases this covers:
//  1) "change address out of zone" — the request body carries a NEW shipping
//     address; we must validate against that new address (it is what the cart
//     will have after this mutation), not the stale current address.
//  2) "add/remove a line item while a stale bad method sits on the cart" — no
//     new address in the body; we validate against the cart's CURRENT address.
//
// Layers 2 (cart.updated subscriber) and 3 (GET /store/shipping-options filter)
// remain as backstops: Layer 3 keeps an unserviceable option from being offered,
// Layer 2 catches non-API cart.updated events. This Layer 1 is the request-path
// front-line so the customer never even sees one error.
//
// Fail open: ANY error in here proceeds to next() unchanged. A failure to heal
// must never block a cart mutation.

type EffectiveAddress = {
  postal_code?: string | null
  city?: string | null
  province?: string | null
}

/**
 * Pull a shipping address out of a cart-mutation request body, if one is
 * present. Two shapes are supported:
 *   - nested: `req.body.shipping_address` (POST /store/carts/:id with an address)
 *   - flat:   `req.body` itself carrying postal_code/city (some address-update
 *             call shapes)
 * Returns null when the body carries no postal_code (so the caller falls back to
 * the cart's current address).
 */
export function extractAddressFromBody(body: unknown): EffectiveAddress | null {
  if (!body || typeof body !== "object") return null
  const b = body as Record<string, any>

  const nested = b.shipping_address
  if (
    nested &&
    typeof nested === "object" &&
    typeof nested.postal_code === "string" &&
    nested.postal_code.trim()
  ) {
    return {
      postal_code: nested.postal_code,
      city: typeof nested.city === "string" ? nested.city : null,
      province: typeof nested.province === "string" ? nested.province : null,
    }
  }

  // Flat address-update shape: the body itself is the address.
  if (typeof b.postal_code === "string" && b.postal_code.trim()) {
    return {
      postal_code: b.postal_code,
      city: typeof b.city === "string" ? b.city : null,
      province: typeof b.province === "string" ? b.province : null,
    }
  }

  return null
}

/**
 * Resolve the cart id from a cart-mutation request. Prefers the route param
 * `id`, then `cart_id`, then parses it out of the request path
 * (/store/carts/<cartId>[/...]).
 */
export function resolveCartIdFromRequest(req: {
  params?: Record<string, any>
  path?: string
}): string | null {
  const fromParams =
    (req.params?.id as string | undefined) ||
    (req.params?.cart_id as string | undefined)
  if (typeof fromParams === "string" && fromParams.trim()) {
    return fromParams.trim()
  }

  const path = typeof req.path === "string" ? req.path : ""
  const match = path.match(/\/store\/carts\/([^/?]+)/)
  if (match?.[1]) {
    return decodeURIComponent(match[1])
  }

  return null
}

/**
 * Core, harness-free logic for the synchronous self-heal. Exported for unit
 * testing: it takes the resolved scope + request shape and returns the list of
 * shipping-method ids it removed (so a test can assert without the full Medusa
 * HTTP middleware stack). NEVER throws — it logs and returns [] on any failure.
 */
export async function dropUnserviceableShippingMethods(req: {
  scope: { resolve: (key: string) => any }
  params?: Record<string, any>
  path?: string
  body?: unknown
}): Promise<string[]> {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const cartId = resolveCartIdFromRequest(req)
    if (!cartId) {
      return []
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "shipping_address.postal_code",
        "shipping_address.city",
        "shipping_address.province",
        "shipping_methods.id",
        "shipping_methods.name",
        "shipping_methods.data",
        "shipping_methods.shipping_option_id",
        "shipping_methods.shipping_option.name",
        "shipping_methods.shipping_option.data",
      ],
      filters: { id: cartId },
    })

    const cart = data?.[0] as any
    if (!cart) {
      return []
    }

    const methods: any[] = Array.isArray(cart.shipping_methods)
      ? cart.shipping_methods
      : []
    if (methods.length === 0) {
      return []
    }

    // Effective address: a NEW address in the request body wins (covers the
    // "change address out of zone" case); otherwise the cart's CURRENT address.
    const effectiveAddress: EffectiveAddress | null =
      extractAddressFromBody(req.body) || cart.shipping_address || null

    const invalidMethodIds: string[] = []
    for (const method of methods) {
      const serviceCode = resolveServiceCodeFromMethod(method)
      // Fast path: only restricted services can be unserviceable — skip the
      // Strapi round-trip for everything else (UPS / pickup / unknown).
      if (!ZIP_RESTRICTED_SERVICE_CODES.has(serviceCode)) continue

      const serviceable = await isDestinationServiceable(
        serviceCode,
        effectiveAddress
      )
      if (!serviceable && method?.id) {
        invalidMethodIds.push(method.id)
      }
    }

    if (invalidMethodIds.length === 0) {
      return []
    }

    const cartModuleService = req.scope.resolve(Modules.CART)
    await cartModuleService.deleteShippingMethods(invalidMethodIds)

    logger.info(
      `[cart-shipping-presync] removed ${invalidMethodIds.length} unserviceable shipping method(s) from cart ${cartId} before re-price: ${invalidMethodIds.join(", ")}`
    )

    return invalidMethodIds
  } catch (error) {
    // Fail open: a heal failure must never block the cart mutation.
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[cart-shipping-presync] synchronous heal failed; proceeding with mutation: ${message}`
    )
    emitGuardFailureAlert({
      logger,
      alertKind: "mw_drop_unserviceable_methods_failed",
      severity: "warn",
      title: "middleware: drop-unserviceable-shipping-methods heal failed",
      error,
    })
    return []
  }
}

/**
 * Express-style middleware wrapper. AWAITS the heal before calling next() so the
 * subsequent core re-price never observes the stale method (this is what makes
 * the self-heal synchronous). ALWAYS calls next(); never blocks the mutation.
 */
async function dropUnserviceableShippingMethodsBeforeMutation(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction
) {
  try {
    await dropUnserviceableShippingMethods(req as any)
  } catch {
    // dropUnserviceableShippingMethods already fails open internally; this is a
    // belt-and-suspenders guard so a wrapper-level throw can never block next().
  }
  return next()
}

export default defineMiddlewares({
  // Global error handler: emits an ops alert for unhandled throws from any API
  // route, then DELEGATES to Medusa's core error handler so the client error
  // response is unchanged. See ./middlewares/ops-error-handler.ts.
  errorHandler: opsErrorHandler,
  routes: [
    {
      matcher: "/store/shipping-options",
      method: ["GET"],
      middlewares: [filterUnserviceableShippingOptions],
    },
    // LAYER 1 (synchronous front-line): drop unserviceable methods BEFORE the
    // cart-mutation core handlers that re-price shipping. :param matchers are
    // confirmed supported in this Medusa version (see /admin/orders/:id/... and
    // /store/carts/:id/line-items registrations below).
    {
      matcher: "/store/carts/:id",
      method: ["POST"],
      middlewares: [dropUnserviceableShippingMethodsBeforeMutation],
    },
    {
      matcher: "/store/carts/:id/line-items/:line_id",
      method: ["POST", "DELETE"],
      middlewares: [dropUnserviceableShippingMethodsBeforeMutation],
    },
    {
      matcher: "/store/legacy-order-history/*",
      method: ["GET", "POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/customers/me/password",
      method: ["POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/payment-methods*",
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/grillers/checkout*",
      method: ["POST"],
      middlewares: [authenticate("customer", ["session", "bearer"])],
    },
    {
      matcher: "/store/carts/:id/line-items",
      method: ["POST"],
      // Heal stale unserviceable methods first (always runs, fail-open), then
      // the RM line-item guard (which may short-circuit with a 400).
      middlewares: [
        dropUnserviceableShippingMethodsBeforeMutation,
        blockInternalRawMaterialLineItems,
      ],
    },
    {
      matcher: "/admin/legacy-orders*",
      method: ["GET"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/legacy-order-history/*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/legacy-reorder-requests*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/legacy-item-mapping-candidates*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/grillers/payments*",
      method: ["POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/grillers/inventory*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/grillers/finalization*",
      method: ["GET", "POST"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/grillers/orders/*/finalization*",
      method: ["GET", "POST", "PATCH"],
      middlewares: [authenticate("user", ["session", "bearer", "api-key"])],
    },
    {
      matcher: "/admin/orders/:id/fulfillments",
      method: ["POST"],
      middlewares: [blockFulfillmentBeforeFinalCharge],
    },
    {
      matcher: "/admin/orders/:id/fulfillments/*/shipments",
      method: ["POST"],
      middlewares: [blockFulfillmentBeforeFinalCharge],
    },
    {
      matcher: "/admin/fulfillments",
      method: ["POST"],
      middlewares: [blockFulfillmentBeforeFinalCharge],
    },
    {
      // Stripe webhook (payment_intent.payment_failed). Not under /admin or
      // /store, so it bypasses customer/user auth; preserve the raw body so the
      // route can verify the Stripe-Signature HMAC over the exact bytes.
      matcher: "/webhooks/stripe/payment-failed",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
    {
      // Slack `/gp` slash-command query bot. Outside /admin and /store, so it
      // bypasses Medusa auth; the Slack signing secret is the ONLY gate. Slack
      // sends application/x-www-form-urlencoded, so preserve the raw body — it
      // is needed for BOTH the X-Slack-Signature HMAC and the payload parse.
      matcher: "/webhooks/slack/command",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
    {
      // Slack interactivity endpoint (on-call "✅ Ack" button). Outside /admin
      // and /store so it bypasses Medusa auth — the Slack signing secret is the
      // ONLY gate. Slack sends application/x-www-form-urlencoded with a single
      // `payload` field, so preserve the raw body for the X-Slack-Signature HMAC
      // (verified over the exact bytes) and the payload parse.
      matcher: "/webhooks/slack/interactivity",
      method: ["POST"],
      bodyParser: { preserveRawBody: true },
    },
  ],
})
