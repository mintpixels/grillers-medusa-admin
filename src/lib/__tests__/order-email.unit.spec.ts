import { normalizeOrderForEmail } from "../emails/order-fetch"
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
})
