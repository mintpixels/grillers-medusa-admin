import { fetchOrderForEmail, normalizeOrderForEmail } from "../emails/order-fetch"
import { buildOrderPlacedEmail } from "../emails/templates/order-placed"
import { buildOrderCanceledEmail } from "../emails/templates/order-canceled"
import { buildRefundIssuedEmail } from "../emails/templates/refund-issued"
import { buildPasswordResetEmail } from "../emails/templates/password-reset"

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
      display_title: "Ground Beef 85/15 - 1 lb Pack",
      sku: "1-00-12-1",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Ground Beef 85/15 - 1 lb Pack")
    expect(email.html).toContain("SKU 1-00-12-1")
    expect(email.html).not.toContain("Uncooked")
    expect(email.html).not.toContain("NOT Kosher for Passover")
    expect(email.text).toContain(
      "1 x Ground Beef 85/15 - 1 lb Pack (SKU 1-00-12-1)"
    )
    expect(email.text).not.toContain("NOT Kosher for Passover")
  })

  it("uses the website logo and aligned status strip in order emails", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_branding",
      display_id: 37,
      email: "customer@example.com",
      currency_code: "usd",
      total: 10.69,
      subtotal: 10.69,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_branding",
          title: "Ground Beef 85/15 - 1 lb Pack",
          metadata: { sku: "1-00-12-1" },
          quantity: 1,
          unit_price: 10.69,
          total: 10.69,
        },
      ],
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("/images/logos/logo-horizontal.png")
    expect(email.html).toContain('alt="Griller\'s Pride"')
    expect(email.html).toContain("vertical-align:top")
    expect(email.html).toContain("Butcher review")
  })

  it("renders canceled emails with customer titles, SKU subtext, and brand logo", () => {
    const legacyTitle =
      "1 lb. Pack Ground Beef, 85/15, Uncooked, Vacuum Pack. NOT Kosher for Passover."
    const order = normalizeOrderForEmail({
      id: "order_email_canceled_title",
      display_id: 38,
      email: "customer@example.com",
      currency_code: "usd",
      total: 10.69,
      subtotal: 10.69,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_canceled_title",
          title: legacyTitle,
          product_title: legacyTitle,
          variant_title: legacyTitle,
          metadata: {
            strapi_title: legacyTitle,
            sku: "1-00-12-1",
          },
          quantity: 1,
          unit_price: 10.69,
          total: 10.69,
        },
      ],
    })

    const email = buildOrderCanceledEmail({ order, reason: "Test cancellation" })
    expect(email.html).toContain("/images/logos/logo-horizontal.png")
    expect(email.html).toContain("Ground Beef 85/15 - 1 lb Pack")
    expect(email.html).toContain("SKU 1-00-12-1")
    expect(email.html).not.toContain("NOT Kosher for Passover")
    expect(email.html).not.toContain("Uncooked")
    expect(email.text).toContain(
      "1 x Ground Beef 85/15 - 1 lb Pack (SKU 1-00-12-1)"
    )
  })

  it("collapses prepared-food legacy import titles before rendering emails", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_prepared_food_titles",
      display_id: 41,
      email: "customer@example.com",
      currency_code: "usd",
      total: 50.98,
      subtotal: 50.98,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_soup",
          title:
            "CHICKEN Soup, with Chicken Pieces and Vegetables, in a Quart-size Microwaveable Container, NO MSG, Gluten Free, Not Kosher for Passover.",
          product_title:
            "CHICKEN Soup, with Chicken Pieces and Vegetables, in a Quart-size Microwaveable Container, NO MSG, Gluten Free, Not Kosher for Passover.",
          metadata: { sku: "10-01-11-0" },
          quantity: 1,
          unit_price: 15,
          total: 15,
        },
        {
          id: "line_pies",
          title:
            "Chicken and Mushroom POCKET PIES (5 per box) NOT Kosher for Passover. NO MSG, NOT Gluten Free.",
          product_title:
            "Chicken and Mushroom POCKET PIES (5 per box) NOT Kosher for Passover. NO MSG, NOT Gluten Free.",
          metadata: { sku: "10-08-11-1" },
          quantity: 2,
          unit_price: 17.99,
          total: 35.98,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "Chicken Soup",
      sku: "10-01-11-0",
      variant_title: null,
    })
    expect(order.items?.[1]).toMatchObject({
      display_title: "Chicken and Mushroom Pocket Pies (5 per box)",
      sku: "10-08-11-1",
      variant_title: null,
    })

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Chicken Soup")
    expect(email.html).toContain("Chicken and Mushroom Pocket Pies (5 per box)")
    expect(email.html).toContain("SKU 10-01-11-0")
    expect(email.html).toContain("SKU 10-08-11-1")
    expect(email.html).not.toContain("Quart-size Microwaveable Container")
    expect(email.html).not.toContain("NO MSG")
    expect(email.html).not.toContain("NOT Gluten Free")
    expect(email.html).not.toContain("Not Kosher for Passover")
  })

  it("preserves useful packaging parentheses when removing legacy Passover text", () => {
    const legacyTitle =
      "Aarons Chicken Hotdogs (8 hotdogs, 12 oz.) NOT Kosher for Passover."
    const order = normalizeOrderForEmail({
      id: "order_email_parentheses",
      display_id: 39,
      email: "customer@example.com",
      currency_code: "usd",
      total: 9.98,
      subtotal: 9.98,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "line_parentheses",
          title: legacyTitle,
          product_title: legacyTitle,
          metadata: {
            strapi_title: legacyTitle,
            sku: "1-06-52-1",
          },
          quantity: 2,
          unit_price: 4.99,
          total: 9.98,
        },
      ],
    })

    expect(order.items?.[0]).toMatchObject({
      display_title: "Aarons Chicken Hotdogs (8 hotdogs, 12 oz.)",
      sku: "1-06-52-1",
    })

    const email = buildOrderCanceledEmail({ order })
    expect(email.html).toContain("Aarons Chicken Hotdogs (8 hotdogs, 12 oz.)")
    expect(email.html).not.toContain("NOT Kosher for Passover")
  })

  it("renders refund emails with the shared website logo", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_refund_logo",
      display_id: 40,
      email: "customer@example.com",
      currency_code: "usd",
      total: 10.69,
      subtotal: 10.69,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [],
    })

    const email = buildRefundIssuedEmail({
      order,
      refundAmount: 5,
      reason: "Test refund",
    })
    expect(email.html).toContain("/images/logos/logo-horizontal.png")
    expect(email.html).toContain("Refund of $5.00")
    expect(email.text).toContain("Refund issued: $5.00")
  })

  it("renders password reset emails with the shared website logo", () => {
    const email = buildPasswordResetEmail({
      email: "customer@example.com",
      token: "reset-token",
    })

    expect(email.html).toContain("/images/logos/logo-horizontal.png")
    expect(email.html).toContain("Reset password")
    expect(email.html).toContain("customer%40example.com")
    expect(email.html).not.toContain("Premium &middot; Kosher &middot; Hand-cut")
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

    const email = buildOrderPlacedEmail(order)
    expect(email.html).toContain("Kosher Wagyu Brisket")
    expect(email.html).not.toContain("8-10 lb")
  })

  it("shows the estimated saved-card total when tax is present", () => {
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
    expect(email.html).toContain("Estimated total")
    expect(email.html).toContain("$91.48")
    expect(email.html).toContain("Qty 1 &times; $84.90")
    expect(email.text).toContain("Taxes (estimated): $6.58")
    expect(email.text).toContain("Estimated total: $91.48")
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
    expect(email.text).toContain("Estimated total: $91.48")
  })

  it("subtracts shipping method amount before deriving tax from payment total", () => {
    const order = normalizeOrderForEmail({
      id: "order_email_shipping_method_total",
      display_id: 45,
      email: "customer@example.com",
      currency_code: "usd",
      total: 50.98,
      subtotal: 50.98,
      discount_total: 0,
      shipping_methods: [
        {
          name: "Scheduled Delivery",
          amount: 40,
        },
      ],
      payment_collections: [
        {
          payments: [
            {
              provider_id: "pp_stripe_stripe",
              amount: 94.93095,
            },
          ],
        },
      ],
      items: [
        {
          id: "line_shipping_method_total",
          title: "Chicken Soup",
          quantity: 1,
          unit_price: 15,
          subtotal: 15,
        },
        {
          id: "line_shipping_method_total_2",
          title: "Pocket Pies",
          quantity: 2,
          unit_price: 17.99,
          subtotal: 35.98,
        },
      ],
    })

    expect(order.subtotal).toBeCloseTo(50.98)
    expect(order.shipping_total).toBeCloseTo(40)
    expect(order.tax_total).toBeCloseTo(3.95095)
    expect(order.total).toBeCloseTo(94.93095)

    const email = buildOrderPlacedEmail(order)
    expect(email.text).toContain("Subtotal: $50.98")
    expect(email.text).toContain("Shipping: $40.00")
    expect(email.text).toContain("Taxes (estimated): $3.95")
    expect(email.text).toContain("Estimated total: $94.93")
    expect(email.text).not.toContain("Taxes (estimated): $43.95")
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
