import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { blockFulfillmentOnSlackHold } from "../middlewares"

// Fake res with jest-mock status/json so we can assert a 409 vs pass-through.
function makeRes() {
  const json = jest.fn()
  const status = jest.fn().mockReturnValue({ json })
  return { status, json, _json: json } as any
}

// Build a req whose scope.resolve switches on the registration key: QUERY
// returns the given order (or throws), LOGGER returns a captured logger.
function makeReq(opts: {
  orderId?: string | undefined
  body?: Record<string, any>
  order?: { id: string; metadata: unknown } | undefined
  graphThrows?: boolean
}) {
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
  const graph = opts.graphThrows
    ? jest.fn().mockRejectedValue(new Error("boom"))
    : jest.fn().mockResolvedValue({ data: opts.order ? [opts.order] : [] })
  return {
    req: {
      params: opts.orderId ? { id: opts.orderId } : {},
      body: opts.body ?? {},
      scope: {
        resolve: (key: string) => {
          if (key === ContainerRegistrationKeys.QUERY) return { graph }
          if (key === ContainerRegistrationKeys.LOGGER) return logger
          return logger
        },
      },
    } as any,
    graph,
    logger,
  }
}

describe("blockFulfillmentOnSlackHold", () => {
  const originalFetch = global.fetch
  beforeEach(() => {
    // The fail-open path emits an ops alert via fire-and-forget fetch; stub it.
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any
  })
  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("BLOCKS (409) an order with fulfillment_hold.held === true and does NOT call next", async () => {
    const { req } = makeReq({
      orderId: "order_held",
      order: {
        id: "order_held",
        metadata: { fulfillment_hold: { held: true, held_by_user: "U1" } },
      },
    })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res._json).toHaveBeenCalledWith(
      expect.objectContaining({ type: "order_on_hold" })
    )
    expect(next).not.toHaveBeenCalled()
  })

  it("allows (next, no 409) an order with held === false", async () => {
    const { req } = makeReq({
      orderId: "order_released",
      order: {
        id: "order_released",
        metadata: { fulfillment_hold: { held: false, released_by_user: "U2" } },
      },
    })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  // THE DEFAULT-FLOW-UNCHANGED case: a normal order has NO fulfillment_hold key
  // at all. The strict `=== true` check must never block it.
  it("NEVER blocks an order with no fulfillment_hold key (default flow unchanged)", async () => {
    const { req } = makeReq({
      orderId: "order_normal",
      order: { id: "order_normal", metadata: { foo: "bar" } },
    })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("does NOT block a truthy-but-non-boolean hold object (held is not === true)", async () => {
    const { req } = makeReq({
      orderId: "order_weird",
      // held is a truthy string, not the boolean true — must NOT block.
      order: {
        id: "order_weird",
        metadata: { fulfillment_hold: { held: "yes" } },
      },
    })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("calls next immediately when there is no orderId", async () => {
    const { req, graph } = makeReq({ orderId: undefined })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(graph).not.toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it("FAILS OPEN (next, no 409) when the order lookup throws", async () => {
    const { req, logger } = makeReq({
      orderId: "order_err",
      graphThrows: true,
    })
    const res = makeRes()
    const next = jest.fn()
    await blockFulfillmentOnSlackHold(req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalled()
  })
})
