type Container = { resolve: (key: string) => any }

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "total",
  "subtotal",
  "tax_total",
  "shipping_total",
  "discount_total",
  "metadata",
  "items.id",
  "items.title",
  "items.quantity",
  "items.unit_price",
  "items.thumbnail",
  "items.variant_title",
  "shipping_address.first_name",
  "shipping_address.last_name",
  "shipping_address.company",
  "shipping_address.address_1",
  "shipping_address.address_2",
  "shipping_address.city",
  "shipping_address.province",
  "shipping_address.postal_code",
  "shipping_address.country_code",
  "shipping_address.phone",
  "shipping_methods.name",
  "shipping_methods.amount",
  "payment_collections.payments.provider_id",
]

export type OrderForEmail = {
  id: string
  display_id?: number | string
  email: string
  currency_code: string
  total: number | string
  subtotal: number | string
  tax_total: number | string
  shipping_total: number | string
  discount_total: number | string
  metadata?: Record<string, any> | null
  items?: Array<{
    id: string
    title?: string
    quantity?: number
    unit_price?: number
    thumbnail?: string | null
    variant_title?: string | null
  }>
  shipping_address?: {
    first_name?: string | null
    last_name?: string | null
    company?: string | null
    address_1?: string | null
    address_2?: string | null
    city?: string | null
    province?: string | null
    postal_code?: string | null
    country_code?: string | null
    phone?: string | null
  } | null
  shipping_methods?: Array<{ name?: string; amount?: number }>
  payment_collections?: Array<{ payments?: Array<{ provider_id?: string }> }>
}

export const fetchOrderForEmail = async (
  container: Container,
  orderId: string
): Promise<OrderForEmail | null> => {
  const query = container.resolve("query")
  const { data: orders } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id: orderId },
  })
  return (orders?.[0] as OrderForEmail) || null
}

export const getPaymentLabel = (order: OrderForEmail): string => {
  const provider =
    order.payment_collections?.[0]?.payments?.[0]?.provider_id || ""
  if (provider.includes("stripe")) return "Credit Card"
  if (provider.includes("paypal")) return "PayPal"
  if (provider.includes("manual")) return "Payment on file"
  return "Payment"
}

export const getFulfillmentInfo = (order: OrderForEmail) => {
  const meta = (order.metadata || {}) as Record<string, any>
  const fulfillmentType = meta.fulfillmentType as string | undefined
  const isPickup = fulfillmentType === "plant_pickup"
  const isLocalDelivery = fulfillmentType === "local_delivery"
  const scheduledDate = meta.scheduledDate as string | undefined
  const requestedDeliveryDate = meta.requestedDeliveryDate as string | undefined
  const fulfillmentZip = meta.fulfillmentZip as string | undefined

  const shippingMethodName =
    order.shipping_methods?.[0]?.name ||
    (isPickup ? "Plant Pickup" : isLocalDelivery ? "Local Delivery" : "Shipping")

  return {
    fulfillmentType,
    isPickup,
    isLocalDelivery,
    scheduledDate,
    requestedDeliveryDate,
    fulfillmentZip,
    shippingMethodName,
  }
}
