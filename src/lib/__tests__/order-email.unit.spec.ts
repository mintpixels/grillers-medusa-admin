import { fetchOrderForEmail, normalizeOrderForEmail } from "../emails/order-fetch"
import { buildOrderPlacedEmail } from "../emails/templates/order-placed"

describe("order email rendering", () => {
  it("uses customer-facing line metadata titles instead of source accounting titles", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_1",
      display_id: 29,
      email: "customer@example.com",
      currency_code: "usd",
      total: 0,
      subtotal: 0,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_1",
          title: "108A Bnls RIBEYE Roast Fresh Beef Choice Per LB",
          product_title: "108A Bnls RIBEYE Roast Fresh Beef Choice Per LB",
          variant_title: "12-14 lb",
          metadata: {
            strapi_title: "Kosher American Angus Boneless Ribeye Roast",
          },
          detail: { quantity: 1 },
          unit_price: 84.9,
          total: 0,
        },
      ],
    })

    expect(order.total).toBe(84.9)
    expect(order.items?.[0]).toMatchObject({
      title: "Kosher American Angus Boneless Ribeye Roast",
      display_title: "Kosher American Angus Boneless Ribeye Roast",
      source_title: "108A Bnls RIBEYE Roast Fresh Beef Choice Per LB",
      line_total: 84.9,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Kosher American Angus Boneless Ribeye Roast")
    expect(email.html).not.toContain("108A Bnls RIBEYE")
    expect(email.html).toContain("$84.90")
    expect(email.text).toContain("1 x Kosher American Angus Boneless Ribeye Roast")
  })

  it("does not render QuickBooks product titles as customer email subtitles", () => {
    const accountingTitle =
      "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb."
    const order = normalizeOrderForEmail({
      id: "order_email_3",
      display_id: 34,
      email: "customer@example.com",
      currency_code: "usd",
      total: 84.9,
      subtotal: 84.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_3",
          title: accountingTitle,
          product_title: accountingTitle,
          variant_title: accountingTitle,
          variant: {
            sku: "1-00-12-0",
          },
          metadata: {
            strapi_title: "Ground Beef 75/25 - 10 lb Tube",
          },
          quantity: 1,
          unit_price: 84.9,
          total: 84.9,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "Ground Beef 75/25 - 10 lb Tube",
      source_title: accountingTitle,
      sku: "1-00-12-0",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Ground Beef 75/25 - 10 lb Tube")
    expect(email.html).toContain("SKU 1-00-12-0")
    expect(email.html).not.toContain("Institutional, (75/25)")
    expect(email.text).not.toContain("Institutional, (75/25)")
  })

  it("uses metadata SKU as the email subtitle when variant titles are accounting titles", () => {
    const accountingTitle =
      "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb."
    const order = normalizeOrderForEmail({
      id: "order_email_metadata_sku",
      display_id: 35,
      email: "customer@example.com",
      currency_code: "usd",
      total: 84.9,
      subtotal: 84.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_metadata_sku",
          title: "Ground Beef 75/25 - 10 lb Tube",
          product_title: "Ground Beef 75/25 - 10 lb Tube",
          variant_title: accountingTitle,
          variant: {
            title: accountingTitle,
          },
          metadata: {
            sku: "1-00-12-0",
          },
          quantity: 1,
          unit_price: 84.9,
          total: 84.9,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "Ground Beef 75/25 - 10 lb Tube",
      sku: "1-00-12-0",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Ground Beef 75/25 - 10 lb Tube")
    expect(email.html).toContain("SKU 1-00-12-0")
    expect(email.html).not.toContain("Institutional, (75/25)")
    expect(email.text).toContain("1 x Ground Beef 75/25 - 10 lb Tube (SKU 1-00-12-0)")
    expect(email.text).not.toContain("Institutional, (75/25)")
  })

  it("cleans legacy catalog titles before rendering customer emails", () => {
    const legacyTitle =
      "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover."
    const order = normalizeOrderForEmail({
      id: "order_email_legacy_title",
      display_id: 36,
      email: "customer@example.com",
      currency_code: "usd",
      total: 8.49,
      subtotal: 8.49,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_legacy_title",
          title: legacyTitle,
          product_title: legacyTitle,
          variant_title: legacyTitle,
          metadata: {
            strapi_title: legacyTitle,
            sku: "1-00-12-1",
          },
          quantity: 1,
          unit_price: 8.49,
          total: 8.49,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "1 lb Pack Ground Beef, 85/15, Vacuum Pack",
      sku: "1-00-12-1",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("1 lb Pack Ground Beef, 85/15, Vacuum Pack")
    expect(email.html).toContain("SKU 1-00-12-1")
    expect(email.html).not.toContain("Uncooked")
    expect(email.html).not.toContain("NOT Kosher for Passover")
    expect(email.text).toContain(
      "1 x 1 lb Pack Ground Beef, 85/15, Vacuum Pack (SKU 1-00-12-1)"
    )
    expect(email.text).not.toContain("NOT Kosher for Passover")
  })

  it("suppresses QuickBooks titles that arrive from expanded variant records", () => {
    const accountingTitle =
      "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb."
    const order = normalizeOrderForEmail({
      id: "order_email_4",
      display_id: 39,
      email: "customer@example.com",
      currency_code: "usd",
      total: 169.8,
      subtotal: 169.8,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_4",
          title: "Ground Beef 75/25 - 10 lb Tube",
          product_title: accountingTitle,
          variant: {
            title: accountingTitle,
            product: {
              title: accountingTitle,
            },
          },
          metadata: {
            strapi_title: "Ground Beef 75/25 - 10 lb Tube",
          },
          quantity: 2,
          unit_price: 84.9,
          total: 169.8,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "Ground Beef 75/25 - 10 lb Tube",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Ground Beef 75/25 - 10 lb Tube")
    expect(email.html).not.toContain("Institutional, (75/25)")
    expect(email.text).not.toContain("Institutional, (75/25)")
  })

  it("falls back through variant product data when product_title is absent", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_2",
      display_id: 30,
      email: "customer@example.com",
      currency_code: "usd",
      total: 0,
      subtotal: 0,
      shipping_total: 12.5,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_2",
          title: "BRISKET FRESH RAW PER LB",
          variant: {
            title: "8-10 lb",
            product: {
              title: "Kosher Wagyu Brisket",
            },
          },
          quantity: 2,
          unit_price: 72.25,
          total: 0,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      title: "Kosher Wagyu Brisket",
      variant_title: "8-10 lb",
    })
    expect(order.total).toBe(157)
  })

  it("shows the Stripe-authorized total when tax is present", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_tax",
      display_id: 43,
      email: "customer@example.com",
      currency_code: "usd",
      total: 84.9,
      subtotal: 84.9,
      item_total: 91.47975,
      item_subtotal: 84.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_tax",
          title: "Ground Beef 75/25 - 10 lb Tube",
          quantity: 1,
          unit_price: 84.9,
          total: 91.47975,
          subtotal: 84.9,
          raw_total: { value: "91.47975", precision: 20 },
          raw_subtotal: { value: "84.9", precision: 20 },
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      line_total: 84.9,
      unit_price: 84.9,
    })
    expect(order.tax_total).toBeCloseTo(6.57975)
    expect(order.total).toBeCloseTo(91.47975)

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Taxes (estimated)")
    expect(email.html).toContain("$6.58")
    expect(email.html).toContain("Total (authorized)")
    expect(email.html).toContain("$91.48")
    expect(email.html).toContain("Qty 1 &times; $84.90")
    expect(email.text).toContain("Taxes (estimated): $6.58")
    expect(email.text).toContain("Total (authorized): $91.48")
  })

  it("uses the payment authorization amount when event-time order totals are pre-tax", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_payment_total",
      display_id: 44,
      email: "customer@example.com",
      currency_code: "usd",
      total: 84.9,
      subtotal: 84.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      payment_collections: [
        {
          payments: [
            {
              provider_id: "pp_stripe_stripe",
              amount: 91.47975,
            },
          ],
        },
      ],
      items: [
        {
          id: "line_payment_total",
          title: "Ground Beef 75/25 - 10 lb Tube",
          quantity: 1,
          unit_price: 84.9,
          total: 84.9,
          subtotal: 84.9,
        },
      ],
    })

    expect(order.tax_total).toBeCloseTo(6.57975)
    expect(order.total).toBeCloseTo(91.47975)

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("$6.58")
    expect(email.html).toContain("$91.48")
    expect(email.text).toContain("Taxes (estimated): $6.58")
    expect(email.text).toContain("Total (authorized): $91.48")
  })

  it("hydrates Strapi titles before sending customer emails", async () => {
    const accountingTitle =
      "10 lb. TUBE Ground Beef (Alle) Institutional, (75/25) Uncooked, NOT Kosher for Passover @ $8.49/lb."
    const graph = jest.fn(async () => ({
      data: [
        {
          id: "order_email_strapi",
          display_id: 42,
          email: "customer@example.com",
          currency_code: "usd",
          total: 84.9,
          subtotal: 84.9,
          shipping_total: 0,
          tax_total: 0,
          discount_total: 0,
          items: [
            {
              id: "line_strapi",
              title: accountingTitle,
              product_title: accountingTitle,
              variant: {
                sku: "1-00-12-0",
                product: {
                  id: "prod_ground_beef",
                  title: accountingTitle,
                },
              },
              quantity: 1,
              unit_price: 84.9,
              total: 84.9,
            },
          ],
        },
      ],
    }))
    const findProductByMedusaId = jest.fn(async () => ({
      Title: "Kosher Alle Ground Beef 75/25 Tube · 10 lb",
    }))
    const container = {
      resolve: (key: string) => {
        if (key === "query") return { graph }
        if (key === "strapi") return { findProductByMedusaId }
        if (key === "logger") return { warn: jest.fn() }
        throw new Error(`Unknown dependency ${key}`)
      },
    }

    const order = await fetchOrderForEmail(container, "order_email_strapi")
    const email = buildOrderPlacedEmail(order!)

    expect(findProductByMedusaId).toHaveBeenCalledWith("prod_ground_beef")
    expect(order?.items?.[0]).toMatchObject({
      title: "Kosher Alle Ground Beef 75/25 Tube · 10 lb",
      sku: "1-00-12-0",
      variant_title: null,
    })
    expect(email.html).toContain("Kosher Alle Ground Beef 75/25 Tube · 10 lb")
    expect(email.html).toContain("SKU 1-00-12-0")
    expect(email.html).not.toContain("Institutional, (75/25)")
    expect(email.text).not.toContain("Institutional, (75/25)")
  })
})
