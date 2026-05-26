import {
  addToCartWorkflowId,
  deleteLineItemsWorkflowId,
  updateCartWorkflowId,
  updateLineItemInCartWorkflowId,
} from "@medusajs/core-flows"
import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeRes() {
  return {
    status: jest.fn(function status() {
      return this
    }),
    json: jest.fn(),
  } as any
}

function makeReq(body: Record<string, unknown>, cartOverrides = {}) {
  const workflowEngine = {
    run: jest.fn(async () => undefined),
  }
  const cart = {
    id: "cart_123",
    email: "customer@example.com",
    metadata: { fulfillmentType: "plant_pickup" },
    items: [
      {
        id: "cali_original",
        variant_id: "variant_original",
        quantity: 2,
        metadata: { existing: true },
        title: "Ground Beef 75/25 - 10 lb Tube",
        variant_sku: "10-11-01-1",
      },
    ],
    ...cartOverrides,
  }
  const query = {
    graph: jest.fn(async () => ({ data: [cart] })),
  }
  const req = {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === Modules.WORKFLOW_ENGINE) return workflowEngine
        if (key === "query") return query
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any

  return { req, query, workflowEngine }
}

describe("store inventory resolution route", () => {
  it("requires cart and resolution data", async () => {
    const { req } = makeReq({})
    const res = makeRes()

    await POST(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false })
    )
  })

  it("substitutes an unavailable line with a replacement variant", async () => {
    const { req, workflowEngine } = makeReq({
      cart_id: "cart_123",
      requested_fulfillment_date: "2026-06-10",
      resolutions: [
        {
          original_variant_id: "variant_original",
          action: "substitute",
          replacement_variant_id: "variant_replacement",
          quantity: 1,
        },
      ],
    })
    const res = makeRes()

    await POST(req, res)

    expect(workflowEngine.run).toHaveBeenCalledWith(addToCartWorkflowId, {
      input: {
        cart_id: "cart_123",
        items: [
          expect.objectContaining({
            variant_id: "variant_replacement",
            quantity: 1,
            metadata: expect.objectContaining({
              inventory_resolution_action: "substitute",
              inventory_resolution_original_line_id: "cali_original",
              inventory_resolution_original_sku: "10-11-01-1",
            }),
          }),
        ],
      },
      transactionId: "inventory-resolution-substitute-cart_123-0",
    })
    expect(workflowEngine.run).toHaveBeenCalledWith(deleteLineItemsWorkflowId, {
      input: { cart_id: "cart_123", ids: ["cali_original"] },
      transactionId: "inventory-resolution-remove-original-cart_123-0",
    })
    expect(workflowEngine.run).toHaveBeenCalledWith(
      updateCartWorkflowId,
      expect.objectContaining({
        input: expect.objectContaining({
          id: "cart_123",
          metadata: expect.objectContaining({
            inventory_resolution_requested_fulfillment_date: "2026-06-10",
          }),
        }),
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it("reduces quantity for complete-available-only resolutions", async () => {
    const { req, workflowEngine } = makeReq({
      cart_id: "cart_123",
      resolutions: [
        {
          original_variant_id: "variant_original",
          action: "complete_available_only",
          quantity: 1,
        },
      ],
    })
    const res = makeRes()

    await POST(req, res)

    expect(workflowEngine.run).toHaveBeenCalledWith(
      updateLineItemInCartWorkflowId,
      expect.objectContaining({
        input: {
          cart_id: "cart_123",
          item_id: "cali_original",
          update: expect.objectContaining({
            quantity: 1,
            metadata: expect.objectContaining({
              existing: true,
              inventory_resolution_action: "complete_available_only",
            }),
          }),
        },
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })

  it("removes waitlisted lines so unresolved items cannot proceed to checkout", async () => {
    const { req, workflowEngine } = makeReq({
      cart_id: "cart_123",
      resolutions: [
        {
          original_variant_id: "variant_original",
          action: "waitlist",
          email: "customer@example.com",
        },
      ],
    })
    const res = makeRes()

    await POST(req, res)

    expect(workflowEngine.run).toHaveBeenCalledWith(deleteLineItemsWorkflowId, {
      input: { cart_id: "cart_123", ids: ["cali_original"] },
      transactionId: "inventory-resolution-delete-cart_123-0",
    })
    expect(workflowEngine.run).toHaveBeenCalledWith(
      updateCartWorkflowId,
      expect.objectContaining({
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            inventory_resolution_waitlist_email: "customer@example.com",
          }),
        }),
      })
    )
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
