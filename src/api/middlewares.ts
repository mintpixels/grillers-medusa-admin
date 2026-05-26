import {
  authenticate,
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

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
  }

  return next()
}

export default defineMiddlewares({
  routes: [
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
      matcher: "/store/carts/:id/line-items",
      method: ["POST"],
      middlewares: [blockInternalRawMaterialLineItems],
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
  ],
})
