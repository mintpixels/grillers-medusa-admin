import orderPlacedHandler from "../../subscribers/analytics/order-placed"

describe("analytics order placed subscriber", () => {
  const logger = {
    error: jest.fn(),
  }
  const analytics = {
    track: jest.fn(),
  }
  const query = {
    graph: jest.fn(),
  }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === "logger") return logger
      if (key === "analytics") return analytics
      if (key === "query") return query
      throw new Error(`unexpected resolve ${key}`)
    }),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    analytics.track.mockResolvedValue(undefined)
  })

  it("requests order metadata and classifies staff, customer type, route, and tier for pending final charge orders", async () => {
    query.graph.mockResolvedValue({
      data: [
        {
          id: "order_pending",
          display_id: 1001,
          cart_id: "cart_pending",
          email: "buyer@example.com",
          currency_code: "usd",
          customer_id: "cus_123",
          total: 120,
          subtotal: 100,
          tax_total: 8,
          shipping_total: 12,
          discount_total: 0,
          metadata: {
            source: "staff_phone_order",
            final_charge_status: "not_started",
          },
          customer: {
            groups: [{ id: "cusgrp_1", name: "Institutional" }],
          },
          shipping_address: {
            province: "GA",
            postal_code: "30329",
          },
          shipping_methods: [
            {
              name: "UPS Ground Estimated Shipping",
              shipping_option_id: "so_ground",
              data: { service_code: "GROUND" },
            },
          ],
          items: [],
        },
      ],
    })

    await orderPlacedHandler({
      event: { name: "order.placed", data: { id: "order_pending" } },
      container,
    } as any)

    const fields = query.graph.mock.calls[0][0].fields
    expect(fields).toEqual(
      expect.arrayContaining([
        "+metadata",
        "shipping_address.*",
        "customer.*",
        "customer.groups.*",
        "shipping_methods.shipping_option_id",
        "+shipping_methods.data",
        "+shipping_methods.metadata",
      ])
    )
    expect(analytics.track).toHaveBeenCalledTimes(1)
    expect(analytics.track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "order_received",
        actor_id: "cus_123",
        properties: expect.objectContaining({
          transaction_id: "order_pending",
          cart_id: "cart_pending",
          source: "staff",
          customer_type: "institutional",
          route_market: "atlanta_metro",
          fulfillment_tier: "ups_ground",
          idempotency_key: "order.placed:order_pending:order_received",
          medusa_event_id: "order.placed:order_pending:order_received",
        }),
      })
    )
  })

  it("uses catch-weight final lines and derived dimensions for final charge events", async () => {
    query.graph.mockResolvedValue({
      data: [
        {
          id: "order_final",
          display_id: 1002,
          cart_id: "cart_final",
          email: "buyer@example.com",
          currency_code: "usd",
          customer_id: "cus_456",
          total: 100,
          subtotal: 90,
          tax_total: 5,
          shipping_total: 5,
          discount_total: 0,
          metadata: {
            source: "admin_staff_reorder",
            final_charge_status: "succeeded",
            estimated_total: 100,
            final_order_total: 130,
            catch_weight_final_lines: [
              {
                line_item_id: "item_1",
                final_line_total: 65,
                delta_line_total: 15,
              },
            ],
          },
          customer: {
            groups: [],
          },
          shipping_address: {
            province: "TX",
            postal_code: "75219",
          },
          shipping_methods: [
            {
              name: "UPS 2nd Day Air Estimated Shipping",
              shipping_option_id: "so_2da",
              data: { service_code: "2ND_DAY_AIR" },
            },
          ],
          payment_collections: [
            {
              payments: [{ provider_id: "stripe" }],
            },
          ],
          items: [
            {
              id: "item_1",
              title: "Ribeye",
              variant_id: "var_1",
              unit_price: 25,
              quantity: 2,
              total: 40,
              variant: { product_id: "prod_1", product: { metadata: {} } },
            },
            {
              id: "item_2",
              title: "Chicken",
              variant_id: "var_2",
              unit_price: 25,
              quantity: 1,
              total: 25,
              variant: { product_id: "prod_2", product: { metadata: {} } },
            },
          ],
        },
      ],
    })

    await orderPlacedHandler({
      event: {
        name: "order.final_charge_succeeded",
        data: {
          id: "order_final",
          order_id: "order_final",
          amount: 130,
          finalization_id: "gpfin_123",
        },
      },
      container,
    } as any)

    expect(analytics.track).toHaveBeenCalledTimes(2)
    const completed = analytics.track.mock.calls.find(
      ([input]) => input.event === "order_completed"
    )?.[0]
    const finalized = analytics.track.mock.calls.find(
      ([input]) => input.event === "order_finalized"
    )?.[0]

    expect(completed.properties).toEqual(
      expect.objectContaining({
        source: "staff",
        customer_type: "dtc",
        route_market: "southeast",
        fulfillment_tier: "ups_2da",
        idempotency_key:
          "order.final_charge_succeeded:order_final:order_completed:gpfin_123",
        medusa_event_id:
          "order.final_charge_succeeded:order_final:order_completed:gpfin_123",
      })
    )
    expect(finalized.properties).toEqual(
      expect.objectContaining({
        source: "staff",
        customer_type: "dtc",
        route_market: "southeast",
        fulfillment_tier: "ups_2da",
        idempotency_key:
          "order.final_charge_succeeded:order_final:order_finalized:gpfin_123",
        medusa_event_id:
          "order.final_charge_succeeded:order_final:order_finalized:gpfin_123",
      })
    )
    expect(finalized.properties.lines).toEqual([
      {
        line_item_id: "item_1",
        variant_id: "var_1",
        estimated_total: 50,
        final_total: 65,
        delta: 15,
      },
      {
        line_item_id: "item_2",
        variant_id: "var_2",
        estimated_total: 25,
        final_total: 25,
        delta: 0,
      },
    ])
  })
})
