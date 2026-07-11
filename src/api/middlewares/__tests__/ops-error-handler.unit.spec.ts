jest.mock("@medusajs/framework/http", () => {
  const coreErrorHandler = jest.fn()
  return {
    errorHandler: jest.fn(() => coreErrorHandler),
    mockCoreErrorHandler: coreErrorHandler,
  }
})

jest.mock("@medusajs/framework/utils", () => ({
  ContainerRegistrationKeys: { LOGGER: "logger" },
}))

jest.mock("../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

import { emitOpsAlert } from "../../../lib/ops-alert"
import { opsErrorHandler } from "../ops-error-handler"

const { mockCoreErrorHandler } = jest.requireMock("@medusajs/framework/http") as {
  mockCoreErrorHandler: jest.Mock
}
const mockEmitOpsAlert = emitOpsAlert as jest.MockedFunction<typeof emitOpsAlert>

function request(input: {
  method?: string
  path?: string
  baseUrl?: string
  routePath?: string
  id?: string
  headers?: Record<string, string | string[] | undefined>
}) {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return {
    logger,
    req: {
      method: input.method || "GET",
      path: input.path || "/store/products",
      baseUrl: input.baseUrl,
      route: input.routePath ? { path: input.routePath } : undefined,
      id: input.id,
      headers: input.headers || {},
      scope: {
        resolve: (key: string) => {
          if (key === "logger") return logger
          throw new Error(`Unexpected dependency: ${key}`)
        },
      },
    } as any,
  }
}

function invoke(err: Record<string, unknown>, req: any) {
  const res = {} as any
  const next = jest.fn()
  opsErrorHandler(err, req, res, next)
  return { next, res }
}

describe("opsErrorHandler alert policy", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEmitOpsAlert.mockResolvedValue({ ok: true, skipped: false })
  })

  it("does not alert for the missing publishable API key 400", () => {
    const err = {
      name: "MedusaError",
      type: "invalid_data",
      message: "Publishable API key required in x-publishable-api-key",
    }
    const { req } = request({ path: "/store/products" })
    const { next, res } = invoke(err, req)

    expect(mockEmitOpsAlert).not.toHaveBeenCalled()
    expect(mockCoreErrorHandler).toHaveBeenCalledWith(err, req, res, next)
  })

  it.each([
    ["unauthorized", 401],
    ["not_found", 404],
    ["conflict", 409],
    ["duplicate_error", 422],
  ])("does not alert for expected %s client errors (%i)", (type) => {
    const err = { name: "MedusaError", type, message: "Expected client error" }
    const { req } = request({ method: "POST", path: "/store/carts/cart_123" })
    const { next, res } = invoke(err, req)

    expect(mockEmitOpsAlert).not.toHaveBeenCalled()
    expect(mockCoreErrorHandler).toHaveBeenCalledWith(err, req, res, next)
  })

  it("does not promote an expected card authorization 422 on a money path", () => {
    const err = {
      name: "MedusaError",
      type: "payment_authorization_error",
      message: "Card declined for shopper@example.com",
    }
    const { req } = request({
      method: "POST",
      path: "/store/grillers/checkout/place-order",
    })
    const { next, res } = invoke(err, req)

    expect(mockEmitOpsAlert).not.toHaveBeenCalled()
    expect(mockCoreErrorHandler).toHaveBeenCalledWith(err, req, res, next)
  })

  it("warns for an unexpected server failure with a safe route and request ID", () => {
    const err = {
      name: "DatabaseError",
      code: "ECONNRESET",
      message: "Query failed for shopper@example.com and cart_secret_123",
    }
    const { logger, req } = request({
      method: "get",
      path: "/ignored-fallback",
      baseUrl: "/store",
      routePath: "/products",
      id: "req-01JZ9AY6ZX8N7M9KTEXAMPLE",
    })
    const { next, res } = invoke(err, req)

    expect(mockEmitOpsAlert).toHaveBeenCalledWith({
      alertKind: "api_unhandled_error",
      severity: "warn",
      path: "/store/products",
      title: "api unhandled error 500: DatabaseError",
      meta: {
        status: 500,
        method: "GET",
        route: "/store/products",
        request_id: "req-01JZ9AY6ZX8N7M9KTEXAMPLE",
        error_type: "DatabaseError",
        error_code: "ECONNRESET",
        high_risk_money_path: false,
      },
      logger,
    })
    const alert = mockEmitOpsAlert.mock.calls[0][0]
    expect(alert.meta).not.toHaveProperty("error_message")
    expect(JSON.stringify(alert)).not.toContain("shopper@example.com")
    expect(mockCoreErrorHandler).toHaveBeenCalledWith(err, req, res, next)
  })

  it("pages only an unexpected failure on an allowlisted money mutation", () => {
    const err = { name: "Error", message: "Stripe connection failed" }
    const { logger, req } = request({
      method: "POST",
      path: "/admin/grillers/payments/pay_01JZ9AY6ZX8N7M9K/refund",
      headers: { "x-request-id": "railway-request-123" },
    })
    const { next, res } = invoke(err, req)

    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "api_unhandled_error",
        severity: "page",
        path: "/admin/grillers/payments/:id/refund",
        logger,
        meta: expect.objectContaining({
          status: 500,
          method: "POST",
          route: "/admin/grillers/payments/:id/refund",
          request_id: "railway-request-123",
          high_risk_money_path: true,
        }),
      })
    )
    expect(mockCoreErrorHandler).toHaveBeenCalledWith(err, req, res, next)
  })

  it("keeps read-only failures on money-shaped routes at warning severity", () => {
    const err = { name: "Error", message: "Read failed" }
    const { req } = request({
      method: "GET",
      path: "/admin/grillers/payments/pay_01JZ9AY6ZX8N7M9K/refund",
    })
    invoke(err, req)

    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warn",
        meta: expect.objectContaining({ high_risk_money_path: false }),
      })
    )
  })

  it("rejects arbitrary request header text instead of forwarding possible PII", () => {
    const err = { name: "Error", message: "Unexpected" }
    const { req } = request({
      headers: { "x-request-id": "shopper@example.com" },
    })
    invoke(err, req)

    expect(mockEmitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ request_id: null }),
      })
    )
  })
})
