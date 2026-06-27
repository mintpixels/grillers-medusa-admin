import { emitOpsAlert } from "../../lib/ops-alert"

const mockRun = jest.fn()

jest.mock("../../workflows/sync-product-to-strapi", () => ({
  syncProductWorkflow: jest.fn(() => ({ run: mockRun })),
}))

jest.mock("../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productCreatedHandler = require("../product-created").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productUpdatedHandler = require("../product-updated").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productDeletedHandler = require("../product-deleted").default

function makeContainer(extra: Record<string, unknown> = {}) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  return {
    logger,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key in extra) return extra[key]
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  }
}

describe("product Strapi sync subscriber alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRun.mockReset()
  })

  it("alerts when product.created cannot sync to Strapi", async () => {
    mockRun.mockRejectedValueOnce(new Error("Strapi create unavailable"))
    const { container, logger } = makeContainer()

    await productCreatedHandler({
      event: { data: { id: "prod_create" } },
      container,
    })

    expect(logger.error).toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "strapi_product_sync_failed",
        title: "Medusa product created sync to Strapi failed",
        path: "src/subscribers/product-created.ts",
        source: "medusa-server",
        severity: "warn",
        logger,
        meta: expect.objectContaining({
          medusa_product_id: "prod_create",
          product_event: "product.created",
          sync_target: "strapi",
          error_message: "Strapi create unavailable",
        }),
      })
    )
  })

  it("alerts when product.updated cannot sync to Strapi", async () => {
    mockRun.mockRejectedValueOnce(new Error("Strapi update timed out"))
    const { container } = makeContainer()

    await productUpdatedHandler({
      event: { data: { id: "prod_update" } },
      container,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "strapi_product_sync_failed",
        title: "Medusa product updated sync to Strapi failed",
        path: "src/subscribers/product-updated.ts",
        meta: expect.objectContaining({
          medusa_product_id: "prod_update",
          product_event: "product.updated",
          error_message: "Strapi update timed out",
        }),
      })
    )
  })

  it("alerts when product.deleted cannot delete the Strapi entry", async () => {
    const strapiService = {
      findProductByMedusaId: jest.fn(async () => ({ documentId: "strapi_doc" })),
      deleteProduct: jest.fn(async () => {
        throw { response: { data: { error: { message: "delete blocked" } } } }
      }),
    }
    const { container } = makeContainer({ strapi: strapiService })

    await productDeletedHandler({
      event: { data: { id: "prod_delete" } },
      container,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "strapi_product_sync_failed",
        title: "Medusa product deleted sync to Strapi failed",
        path: "src/subscribers/product-deleted.ts",
        meta: expect.objectContaining({
          medusa_product_id: "prod_delete",
          product_event: "product.deleted",
          error_message: "delete blocked",
        }),
      })
    )
  })
})
