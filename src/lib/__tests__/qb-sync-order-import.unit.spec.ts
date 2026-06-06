import {
  ORDER_FIELDS,
  buildQbSyncSignature,
  importOrderToQbSync,
  legacyQbdListIdFallbacksForOrder,
  normalizeOrderForQbSync,
  postOrderToQbSync,
} from "../../subscribers/qb-sync-order-import"
import { config as canceledOrderImportConfig } from "../../subscribers/qb-sync-order-canceled-import"
import { config as refundedPaymentImportConfig } from "../../subscribers/qb-sync-payment-refunded-import"

describe("qb-sync order import subscriber", () => {
  it("posts order payloads with the shared sync token", async () => {
    const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }))

    await postOrderToQbSync(
      "https://sync.example.test/api/medusa/orders",
      "sync-token",
      { id: "order_1" },
      fetchMock as unknown as typeof fetch
    )

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.test/api/medusa/orders",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-QB-Sync-Token": "sync-token",
          "X-QB-Sync-Timestamp": expect.any(String),
          "X-QB-Sync-Signature": expect.any(String),
        }),
        body: JSON.stringify({ order: { id: "order_1" } }),
      })
    )
  })

  it("imports order placement before final catch-weight charge so QuickBooks can create the estimated sales order", async () => {
    const previousEndpoint = process.env.QB_SYNC_ORDER_IMPORT_URL
    const previousToken = process.env.QB_SYNC_ORDER_IMPORT_TOKEN
    const previousFetch = global.fetch
    const fetchMock = jest.fn(async () => new Response("{}", { status: 200 }))
    const logger = { warn: jest.fn(), info: jest.fn(), error: jest.fn() }
    const query = {
      graph: jest.fn(async () => ({
        data: [
          {
            id: "order_pending_catch",
            metadata: {
              payment_workflow: "setup_then_final_charge",
              final_charge_status: "not_started",
            },
            items: [],
          },
        ],
      })),
    }
    const db = jest.fn()
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === "logger") {
          return logger
        }
        if (key === "query") {
          return query
        }
        return db
      }),
    }

    process.env.QB_SYNC_ORDER_IMPORT_URL =
      "https://sync.example.test/api/medusa/orders"
    process.env.QB_SYNC_ORDER_IMPORT_TOKEN = "sync-token"
    global.fetch = fetchMock as unknown as typeof fetch

    try {
      await importOrderToQbSync({
        orderId: "order_pending_catch",
        container: container as any,
        source: "order.placed",
      })
    } finally {
      process.env.QB_SYNC_ORDER_IMPORT_URL = previousEndpoint
      process.env.QB_SYNC_ORDER_IMPORT_TOKEN = previousToken
      global.fetch = previousFetch
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sync.example.test/api/medusa/orders",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("order_pending_catch"),
      })
    )
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("imported order=order_pending_catch")
    )
  })

  it("signs order import payloads with a timestamped HMAC", () => {
    expect(buildQbSyncSignature('{"order":{"id":"order_1"}}', "123", "secret"))
      .toHaveLength(64)
  })

  it("requests order item relations that include Medusa computed quantity and variant data", () => {
    expect(ORDER_FIELDS).toEqual(
      expect.arrayContaining([
        "items.*",
        "items.detail.*",
        "items.variant.*",
        "items.variant.product.*",
        "shipping_address.*",
        "billing_address.*",
        "items.metadata",
        "items.variant.metadata",
        "items.variant.product.metadata",
      ])
    )
    expect(ORDER_FIELDS).not.toContain("+items.metadata")
    expect(ORDER_FIELDS).not.toContain("+items.variant.metadata")
    expect(ORDER_FIELDS).not.toContain("+items.variant.product.metadata")
    expect(ORDER_FIELDS).not.toContain("*items")
    expect(ORDER_FIELDS).not.toContain("*shipping_address")
  })

  it("registers a cancellation subscriber so canceled orders refresh the sync app", () => {
    expect(canceledOrderImportConfig.event).toBe("order.canceled")
  })

  it("registers a refund subscriber so staff refunds refresh the sync app", () => {
    expect(refundedPaymentImportConfig.event).toBe("payment.refunded")
  })

  it("normalizes Medusa order line totals when graph payloads omit computed item fields", () => {
    const order = normalizeOrderForQbSync({
      id: "order_1",
      total: 0,
      subtotal: 0,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: null,
          detail: { quantity: 2 },
          unit_price: 84.9,
          total: 0,
          subtotal: null,
        },
      ],
    })

    expect(order.total).toBe(169.8)
    expect(order.subtotal).toBe(169.8)
    expect((order.items as any[])[0]).toMatchObject({
      quantity: 2,
      total: 169.8,
      subtotal: 169.8,
    })
  })

  it("copies QuickBooks list id metadata onto order lines for sync matching", () => {
    const order = normalizeOrderForQbSync({
      id: "order_qbd_list_id",
      total: 25,
      subtotal: 25,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 1,
          unit_price: 25,
          total: 25,
          metadata: { strapi_title: "Ground Beef" },
          variant: {
            sku: "MEDUSA-SKU",
            product: {
              metadata: {
                qbd_list_id: "800049D5-1779670076",
              },
            },
          },
        },
      ],
    })

    expect((order.items as any[])[0].metadata).toMatchObject({
      strapi_title: "Ground Beef",
      qbd_list_id: "800049D5-1779670076",
    })
  })

  it("normalizes finalized catch-weight lines for QuickBooks posting", () => {
    const order = normalizeOrderForQbSync({
      id: "order_final_weight",
      total: 11.52,
      subtotal: 10.69,
      shipping_total: 0,
      tax_total: 0.83,
      discount_total: 0,
      metadata: {
        catch_weight_final_lines: [
          {
            line_item_id: "ordli_1",
            customer_title: "Ground Beef 85/15 - 1 lb Pack",
            qbd_list_id: "800009C7-1502034505",
            pricing_mode: "per_lb",
            actual_quantity: 1,
            actual_piece_count: 6,
            actual_weight_total: 1.07,
            final_line_subtotal: 12.3,
            final_line_total: 13.25,
            note: "Use the firmer pack.",
          },
        ],
      },
      items: [
        {
          id: "ordli_1",
          title: "1-00-12-1 GBD 0102939574",
          quantity: 1,
          unit_price: 11.49,
          total: 11.52,
          subtotal: 10.69,
          metadata: { strapi_title: "Ground Beef" },
        },
      ],
    })

    expect((order.items as any[])[0]).toMatchObject({
      title: "Ground Beef 85/15 - 1 lb Pack",
      quantity: 1.07,
      subtotal: 12.3,
      total: 13.25,
      metadata: {
        qbd_list_id: "800009C7-1502034505",
        catch_weight_actual_quantity: 1,
        catch_weight_actual_piece_count: 6,
        catch_weight_actual_weight_total: 1.07,
        catch_weight_final_line_subtotal: 12.3,
        catch_weight_final_line_total: 13.25,
        catch_weight_customer_title: "Ground Beef 85/15 - 1 lb Pack",
        catch_weight_line_note: "Use the firmer pack.",
      },
    })
  })

  it("adds staff-entered finalization lines to the QuickBooks posting payload", () => {
    const order = normalizeOrderForQbSync({
      id: "order_staff_added_line",
      total: 24,
      subtotal: 24,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      metadata: {
        catch_weight_final_lines: [
          {
            line_item_id: "gpfinadd_123",
            customer_title: "Chicken Soup",
            qbd_list_id: "QBD-SOUP",
            pricing_mode: "fixed_price",
            actual_quantity: 2,
            actual_piece_count: 2,
            actual_unit_price: 12,
            final_line_subtotal: 24,
            final_line_total: 24,
            metadata: {
              staff_added_line: true,
            },
          },
        ],
      },
      items: [],
    })

    expect(order.items).toHaveLength(1)
    expect((order.items as any[])[0]).toMatchObject({
      id: "gpfinadd_123",
      title: "Chicken Soup",
      quantity: 2,
      subtotal: 24,
      total: 24,
      metadata: {
        qbd_list_id: "QBD-SOUP",
        catch_weight_staff_added_line: true,
        catch_weight_actual_quantity: 2,
        catch_weight_final_line_subtotal: 24,
        catch_weight_customer_title: "Chicken Soup",
      },
    })
  })

  it("uses legacy item maps as a fallback when current product metadata is missing", () => {
    const order = normalizeOrderForQbSync(
      {
        id: "order_legacy_map",
        total: 25,
        subtotal: 25,
        shipping_total: 0,
        tax_total: 0,
        discount_total: 0,
        items: [
          {
            title: "Renamed SKU Item",
            quantity: 1,
            unit_price: 25,
            total: 25,
            metadata: { strapi_title: "Renamed SKU Item" },
            variant: {
              id: "variant_legacy",
              sku: "RM-91-TACHB",
            },
          },
        ],
      },
      {
        "variant:variant_legacy": "800007F7-1384114826",
        "sku:rm-91-tachb": "WRONG-LOWER-PRIORITY",
      }
    )

    expect((order.items as any[])[0].metadata).toMatchObject({
      strapi_title: "Renamed SKU Item",
      qbd_list_id: "800007F7-1384114826",
    })
  })

  it("builds legacy item map fallbacks by variant id and SKU", async () => {
    const whereNull = jest.fn().mockReturnThis()
    const andWhere = jest.fn(function (callback) {
      callback({
        orWhereIn: jest.fn().mockReturnThis(),
      })
      return this
    })
    const orderBy = jest.fn().mockReturnThis()
    const select = jest.fn().mockReturnThis()
    const query: any = {
      select,
      whereNull,
      andWhere,
      orderBy,
      then: (resolve: any) =>
        resolve([
          {
            qbd_item_list_id: "800007F7-1384114826",
            medusa_variant_id: "variant_legacy",
            sku: "RM-91-TACHB",
          },
        ]),
    }
    const db: any = jest.fn(() => query)
    db.raw = (value: string) => value

    const fallbacks = await legacyQbdListIdFallbacksForOrder(db, {
      items: [
        {
          variant: {
            id: "variant_legacy",
            sku: "RM-91-TACHB",
          },
        },
      ],
    })

    expect(fallbacks).toMatchObject({
      "variant:variant_legacy": "800007F7-1384114826",
      "sku:rm-91-tachb": "800007F7-1384114826",
    })
  })

  it("prefers Medusa raw line totals for multi-quantity orders", () => {
    const order = normalizeOrderForQbSync({
      id: "order_2",
      total: 84.9,
      subtotal: 84.9,
      item_total: 169.8,
      item_subtotal: 169.8,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 1,
          detail: { quantity: 2 },
          unit_price: 84.9,
          total: 84.9,
          subtotal: 84.9,
          raw_quantity: { value: "2", precision: 20 },
          raw_total: { value: "169.8", precision: 20 },
          raw_subtotal: { value: "169.8", precision: 20 },
        },
      ],
    })

    expect(order.total).toBe(169.8)
    expect(order.subtotal).toBe(169.8)
    expect((order.items as any[])[0]).toMatchObject({
      quantity: 2,
      total: 169.8,
      subtotal: 169.8,
    })
  })

  it("keeps tax in the QuickBooks expected total when Medusa total is pre-tax", () => {
    const order = normalizeOrderForQbSync({
      id: "order_3",
      total: 84.9,
      subtotal: 84.9,
      item_total: 91.47975,
      item_subtotal: 84.9,
      shipping_total: 0,
      tax_total: 6.57975,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 1,
          unit_price: 84.9,
          total: 84.9,
          subtotal: 84.9,
          tax_total: 6.57975,
          raw_total: { value: "91.47975", precision: 20 },
          raw_subtotal: { value: "84.9", precision: 20 },
        },
      ],
    })

    expect(order.total).toBe(91.47975)
    expect(order.subtotal).toBe(84.9)
    expect((order.items as any[])[0]).toMatchObject({
      total: 91.47975,
      subtotal: 84.9,
    })
  })

  it("includes shipping in the sync order total", () => {
    const order = normalizeOrderForQbSync({
      id: "order_shipping_total",
      total: 40.97,
      subtotal: 40.97,
      item_total: 40.97,
      item_subtotal: 40.97,
      shipping_total: 40,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          title: "Ground Beef",
          quantity: 2,
          unit_price: 11.49,
          total: 22.98,
          subtotal: 22.98,
        },
        {
          title: "Pocket Pies",
          quantity: 1,
          unit_price: 17.99,
          total: 17.99,
          subtotal: 17.99,
        },
      ],
    })

    expect(order.total).toBe(80.97)
    expect(order.subtotal).toBe(40.97)
  })
})
