import fs from "node:fs"
import path from "node:path"

import { buildPasswordResetEmail } from "../lib/emails/templates/password-reset"
import { buildOrderPlacedEmail } from "../lib/emails/templates/order-placed"
import { buildOrderShippedEmail } from "../lib/emails/templates/order-shipped"
import { buildOrderCanceledEmail } from "../lib/emails/templates/order-canceled"
import { buildOrderFinalChargeEmail } from "../lib/emails/templates/order-final-charge"
import { buildRefundIssuedEmail } from "../lib/emails/templates/refund-issued"
import { buildWelcomeEmail } from "../lib/emails/templates/welcome"
import type { OrderForEmail } from "../lib/emails/order-fetch"

const sampleOrder: OrderForEmail = {
  id: "order_01KQG43TC3QQ0EMJRKQT8NCDK8",
  display_id: 1042,
  email: "chris+gp@rndpxl.com",
  currency_code: "usd",
  total: 530.24,
  subtotal: 441.87,
  tax_total: 0,
  shipping_total: 88.37,
  discount_total: 0,
  metadata: {
    fulfillmentType: "ups_shipping",
    scheduledDate: "Thursday, April 30, 2026",
  },
  items: [
    {
      id: "li_1",
      title: "Kosher American Angus Boneless Prime Rib",
      variant_title: "12-14 lb",
      quantity: 1,
      unit_price: 441.87,
      thumbnail: null,
    },
  ],
  shipping_address: {
    first_name: "Christopher",
    last_name: "Bollman",
    address_1: "2044 Fox Brook Place",
    city: "Anderson",
    province: "OH",
    postal_code: "45244",
    country_code: "us",
    phone: "(847) 275-5525",
  },
  shipping_methods: [{ name: "UPS Ground Shipping", amount: 88.37 }],
  payment_collections: [
    { payments: [{ provider_id: "pp_stripe_stripe" }] },
  ],
}

const samplePickupOrder: OrderForEmail = {
  ...sampleOrder,
  id: "order_pickup_demo",
  display_id: 1043,
  total: 152.5,
  subtotal: 160.0,
  shipping_total: 0,
  discount_total: 7.5,
  metadata: {
    fulfillmentType: "plant_pickup",
    scheduledDate: "Tuesday, May 5, 2026",
  },
  items: [
    {
      id: "li_2",
      title: "Kosher Wagyu Brisket",
      variant_title: "8-10 lb",
      quantity: 1,
      unit_price: 160.0,
      thumbnail: null,
    },
  ],
  shipping_methods: [{ name: "Plant Pickup", amount: 0 }],
}

const previews = [
  { name: "01-welcome", email: buildWelcomeEmail({ email: "peter@grillerspride.com", firstName: "Peter" }) },
  { name: "02-password-reset", email: buildPasswordResetEmail({ email: "peter@grillerspride.com", token: "demo-token-1234567890abcdef" }) },
  { name: "03-order-placed-shipping", email: buildOrderPlacedEmail(sampleOrder) },
  { name: "04-order-placed-pickup", email: buildOrderPlacedEmail(samplePickupOrder) },
  { name: "05-order-shipped", email: buildOrderShippedEmail({ order: sampleOrder, trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784", carrier: "UPS" }) },
  { name: "06-order-canceled", email: buildOrderCanceledEmail({ order: sampleOrder, reason: "Out of stock" }) },
  { name: "07-order-final-charge-higher", email: buildOrderFinalChargeEmail({ order: sampleOrder, estimatedTotal: 441.87, finalTotal: 458.21 }) },
  { name: "08-order-final-charge-lower", email: buildOrderFinalChargeEmail({ order: sampleOrder, estimatedTotal: 441.87, finalTotal: 421.13 }) },
  { name: "09-refund-issued", email: buildRefundIssuedEmail({ order: sampleOrder, refundAmount: 88.37, reason: "Shipping delay credit" }) },
]

const outDir = path.join(process.cwd(), ".email-previews")
fs.mkdirSync(outDir, { recursive: true })

for (const p of previews) {
  const file = path.join(outDir, `${p.name}.html`)
  fs.writeFileSync(file, p.email.html)
  console.log(`Wrote ${file}  (subject: ${p.email.subject})`)
}

const indexLines = [
  "<!doctype html><html><body style='font-family:sans-serif;padding:24px;'><h1>Griller's Pride email previews</h1><ul>",
  ...previews.map(
    (p) => `<li><a href="./${p.name}.html">${p.name}</a> — ${p.email.subject}</li>`
  ),
  "</ul></body></html>",
]
fs.writeFileSync(path.join(outDir, "index.html"), indexLines.join("\n"))
console.log(`\nOpen ${path.join(outDir, "index.html")} in a browser to review.`)
