import { normalizeOrderForEmail } from "../emails/order-fetch"
import { buildOrderPlacedEmail } from "../emails/templates/order-placed"

describe("order email rendering", () => {
  it("uses customer-facing Medusa product titles instead of source accounting titles", () => {
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
          product_title: "Kosher American Angus Boneless Ribeye Roast",
          variant_title: "12-14 lb",
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
