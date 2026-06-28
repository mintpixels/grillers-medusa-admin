import { emitOpsAlert } from "../ops-alert"

const mockRun = jest.fn()

jest.mock("../../workflows/sync-product-to-strapi", () => ({
  syncProductWorkflow: jest.fn(() => ({ run: mockRun })),
}))

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productCreatedHandler = require("../../subscribers/product-created").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productUpdatedHandler = require("../../subscribers/product-updated").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const productDeletedHandler = require("../../subscribers/product-deleted").default

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

  it("alerts when product.deleted has no matching Strapi entry", async () => {
    const strapiService = {
      findProductByMedusaId: jest.fn(async () => null),
      deleteProduct: jest.fn(),
    }
    const { container, logger } = makeContainer({ strapi: strapiService })

    await productDeletedHandler({
      event: { data: { id: "prod_missing_strapi" } },
      container,
    })

    expect(strapiService.deleteProduct).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      "Strapi entry not found for Medusa ID prod_missing_strapi, nothing to delete."
    )
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "strapi_product_delete_skipped",
        title: "Medusa product delete skipped because Strapi entry was missing",
        path: "src/subscribers/product-deleted.ts",
        severity: "warn",
        fingerprint: "strapi_product_delete_skipped:missing_strapi_entry",
        logger,
        meta: expect.objectContaining({
          medusa_product_id: "prod_missing_strapi",
          strapi_document_id: null,
          product_event: "product.deleted",
          sync_target: "strapi",
          skip_reason: "missing_strapi_entry",
          destructive_sync_enabled: false,
          backup_required_before_destructive_sync: true,
        }),
      })
    )
  })

  it("alerts when product.deleted is skipped by the destructive sync guard", async () => {
    const strapiService = {
      findProductByMedusaId: jest.fn(async () => ({ documentId: "strapi_doc" })),
      deleteProduct: jest.fn(async () => ({
        data: null,
        status: 202,
        statusText: "Skipped by Strapi destructive-sync guard",
      })),
    }
    const { container, logger } = makeContainer({ strapi: strapiService })

    await productDeletedHandler({
      event: { data: { id: "prod_guarded_delete" } },
      container,
    })

    expect(strapiService.deleteProduct).toHaveBeenCalledWith("strapi_doc")
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "strapi_product_delete_skipped",
        title: "Medusa product delete skipped by Strapi destructive-sync guard",
        path: "src/subscribers/product-deleted.ts",
        severity: "warn",
        fingerprint: "strapi_product_delete_skipped:destructive_sync_disabled",
        logger,
        meta: expect.objectContaining({
          medusa_product_id: "prod_guarded_delete",
          strapi_document_id: "strapi_doc",
          product_event: "product.deleted",
          sync_target: "strapi",
          skip_reason: "destructive_sync_disabled",
          destructive_sync_enabled: false,
          backup_required_before_destructive_sync: true,
        }),
      })
    )
  })
})
