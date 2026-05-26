import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  addToCartWorkflowId,
  deleteLineItemsWorkflowId,
  updateCartWorkflowId,
  updateLineItemInCartWorkflowId,
} from "@medusajs/core-flows"
import { Modules } from "@medusajs/framework/utils"

type ResolutionBody = {
  cart_id?: string
  requested_fulfillment_date?: string
  resolutions?: Array<{
    original_variant_id?: string
    action?: "substitute" | "remove" | "waitlist" | "move_order_date" | "complete_available_only"
    replacement_variant_id?: string
    quantity?: number
    email?: string
  }>
}

type CartLine = {
  id: string
  variant_id?: string | null
  quantity?: number
  metadata?: Record<string, unknown> | null
  title?: string | null
  variant_sku?: string | null
}

type Resolution = NonNullable<ResolutionBody["resolutions"]>[number]

const MUTATING_ACTIONS = new Set([
  "substitute",
  "remove",
  "waitlist",
  "move_order_date",
  "complete_available_only",
])

async function fetchCart(req: MedusaRequest, cartId: string) {
  const query = req.scope.resolve("query")
  const { data } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "email",
      "metadata",
      "items.id",
      "items.variant_id",
      "items.quantity",
      "items.metadata",
      "items.title",
      "items.variant_sku",
    ],
    filters: { id: cartId },
  })

  return data?.[0] as
    | {
        id: string
        email?: string | null
        metadata?: Record<string, unknown> | null
        items?: CartLine[]
      }
    | undefined
}

function findLine(cart: Awaited<ReturnType<typeof fetchCart>>, variantId: string) {
  return (cart?.items || []).find((item) => item.variant_id === variantId)
}

function resolutionMetadata(
  resolution: Resolution,
  requestedFulfillmentDate?: string
) {
  return {
    inventory_resolution_action: resolution.action,
    inventory_resolution_original_variant_id: resolution.original_variant_id,
    inventory_resolution_replacement_variant_id:
      resolution.replacement_variant_id || null,
    inventory_resolution_requested_quantity: resolution.quantity || null,
    inventory_resolution_requested_fulfillment_date:
      requestedFulfillmentDate || null,
  }
}

function positiveQuantity(value: unknown) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body || {}) as ResolutionBody
  const resolutions = body.resolutions || []

  if (!body.cart_id) {
    res.status(400).json({ ok: false, message: "cart_id is required." })
    return
  }

  if (!resolutions.length) {
    res.status(400).json({ ok: false, message: "At least one resolution is required." })
    return
  }

  const invalid = resolutions.find((resolution) => {
    if (!resolution.original_variant_id) return true
    if (!resolution.action) return true
    if (!MUTATING_ACTIONS.has(resolution.action)) return true
    if (resolution.action === "substitute" && !resolution.replacement_variant_id) {
      return true
    }
    if (resolution.action === "waitlist" && !resolution.email) return true
    if (
      resolution.action === "complete_available_only" &&
      positiveQuantity(resolution.quantity) < 1
    ) {
      return true
    }
    return false
  })

  if (invalid) {
    res.status(400).json({
      ok: false,
      message: "Each resolution needs an original variant, action, and required action fields.",
    })
    return
  }

  const cart = await fetchCart(req, body.cart_id)
  if (!cart) {
    res.status(404).json({ ok: false, message: "Cart not found." })
    return
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE)
  const applied: Array<Resolution & { line_item_id?: string }> = []
  let cartMetadata: Record<string, unknown> = {
    ...(cart.metadata || {}),
    inventory_resolution_last_submitted_at: new Date().toISOString(),
    inventory_resolution_requested_fulfillment_date:
      body.requested_fulfillment_date || null,
  }

  for (const [index, resolution] of resolutions.entries()) {
    const line = findLine(cart, resolution.original_variant_id!)
    const metadata = resolutionMetadata(
      resolution,
      body.requested_fulfillment_date
    )

    if (resolution.action === "move_order_date") {
      cartMetadata = {
        ...cartMetadata,
        requested_fulfillment_date: body.requested_fulfillment_date || null,
        scheduledDate: body.requested_fulfillment_date || null,
        ...metadata,
      }
      applied.push(resolution)
      continue
    }

    if (!line) {
      res.status(404).json({
        ok: false,
        message: `Cart line for variant ${resolution.original_variant_id} was not found.`,
      })
      return
    }

    if (resolution.action === "substitute") {
      await workflowEngine.run(addToCartWorkflowId, {
        input: {
          cart_id: body.cart_id,
          items: [
            {
              variant_id: resolution.replacement_variant_id,
              quantity: positiveQuantity(resolution.quantity) || line.quantity || 1,
              metadata: {
                ...metadata,
                inventory_resolution_original_line_id: line.id,
                inventory_resolution_original_sku: line.variant_sku || null,
                inventory_resolution_original_title: line.title || null,
              },
            },
          ],
        },
        transactionId: `inventory-resolution-substitute-${body.cart_id}-${index}`,
      })

      await workflowEngine.run(deleteLineItemsWorkflowId, {
        input: {
          cart_id: body.cart_id,
          ids: [line.id],
        },
        transactionId: `inventory-resolution-remove-original-${body.cart_id}-${index}`,
      })
    }

    if (resolution.action === "complete_available_only") {
      await workflowEngine.run(updateLineItemInCartWorkflowId, {
        input: {
          cart_id: body.cart_id,
          item_id: line.id,
          update: {
            quantity: positiveQuantity(resolution.quantity),
            metadata: {
              ...(line.metadata || {}),
              ...metadata,
            },
          },
        },
        transactionId: `inventory-resolution-quantity-${body.cart_id}-${index}`,
      })
    }

    if (resolution.action === "remove" || resolution.action === "waitlist") {
      cartMetadata = {
        ...cartMetadata,
        [`inventory_resolution_${line.id}`]: metadata,
        ...(resolution.action === "waitlist"
          ? {
              inventory_resolution_waitlist_email:
                resolution.email || cart.email || null,
            }
          : {}),
      }

      await workflowEngine.run(deleteLineItemsWorkflowId, {
        input: {
          cart_id: body.cart_id,
          ids: [line.id],
        },
        transactionId: `inventory-resolution-delete-${body.cart_id}-${index}`,
      })
    }

    applied.push({ ...resolution, line_item_id: line.id })
  }

  await workflowEngine.run(updateCartWorkflowId, {
    input: {
      id: body.cart_id,
      metadata: cartMetadata,
    },
    transactionId: `inventory-resolution-cart-${body.cart_id}`,
  })

  const updatedCart = await fetchCart(req, body.cart_id)

  res.status(200).json({
    ok: true,
    cart_id: body.cart_id,
    requested_fulfillment_date: body.requested_fulfillment_date || null,
    resolutions: applied,
    cart: updatedCart || null,
  })
}
