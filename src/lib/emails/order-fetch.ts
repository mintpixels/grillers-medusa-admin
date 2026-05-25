import { STRAPI_MODULE } from "../../modules/strapi"
import StrapiModuleService from "../../modules/strapi/service"

type Container = { resolve: (key: string) => any }

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "created_at",
  "total",
  "subtotal",
  "item_total",
  "item_subtotal",
  "tax_total",
  "shipping_total",
  "discount_total",
  "shipping_subtotal",
  "shipping_tax_total",
  "metadata",
  "items.*",
  "items.detail.*",
  "items.variant.*",
  "items.variant.product.*",
  "shipping_address.*",
  "billing_address.*",
  "shipping_methods.*",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.amount",
  "payment_collections.payments.currency_code",
]

type MaybeMoney = number | string | { value?: number | string } | null | undefined

const numeric = (value: MaybeMoney): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    (typeof value.value === "number" || typeof value.value === "string")
  ) {
    return numeric(value.value)
  }

  return null
}

const firstNumeric = (...values: MaybeMoney[]): number | null => {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== null) {
      return parsed
    }
  }

  return null
}

const firstPositiveNumeric = (...values: MaybeMoney[]): number | null => {
  for (const value of values) {
    const parsed = numeric(value)
    if (parsed !== null && parsed > 0) {
      return parsed
    }
  }

  return null
}

const cleanText = (value: unknown): string | null => {
  const text = String(value ?? "").trim()
  return text === "" ? null : text
}

const objectValue = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {}

const productIdForItem = (item: Record<string, any>): string | null => {
  const variant = objectValue(item.variant)
  const product = objectValue(item.product)
  const variantProduct = objectValue(variant.product)

  return (
    cleanText(item.product_id) ||
    cleanText(product.id) ||
    cleanText(variant.product_id) ||
    cleanText(variantProduct.id)
  )
}

const skuForItem = (item: Record<string, any>): string | null => {
  const variant = objectValue(item.variant)
  const detail = objectValue(item.detail)
  const metadata = objectValue(item.metadata)

  return (
    cleanText(metadata.sku) ||
    cleanText(metadata.variant_sku) ||
    cleanText(metadata.medusa_sku) ||
    cleanText(item.variant_sku) ||
    cleanText(item.sku) ||
    cleanText(detail.sku) ||
    cleanText(variant.sku)
  )
}

const looksLikeAccountingTitle = (value: string | null): boolean => {
  if (!value) {
    return false
  }

  const title = value.toLowerCase()

  return (
    /\binstitutional\b/.test(title) ||
    /\bnot kosher for passover\b/.test(title) ||
    /\bfresh beef choice per lb\b/.test(title) ||
    /@\s*\$?\d+(?:\.\d+)?\s*\/?\s*lb\.?/.test(title) ||
    (title.length > 72 && /\b(per lb|uncooked|choice|alle)\b/.test(title))
  )
}

const strapiTitleFromProduct = (product: Record<string, any>): string | null => {
  const attributes = objectValue(product.attributes)
  const medusaProduct = objectValue(product.MedusaProduct)
  const attributesMedusaProduct = objectValue(attributes.MedusaProduct)

  return (
    cleanText(product.Title) ||
    cleanText(attributes.Title) ||
    cleanText(medusaProduct.Title) ||
    cleanText(attributesMedusaProduct.Title)
  )
}

const hydrateStrapiTitles = async (
  container: Container,
  order: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const rawItems = Array.isArray(order.items) ? order.items : []
  const productIds = Array.from(
    new Set(
      rawItems
        .map((rawItem) => productIdForItem(objectValue(rawItem)))
        .filter((id): id is string => Boolean(id))
    )
  )

  if (!productIds.length) {
    return order
  }

  let strapiSvc: StrapiModuleService
  try {
    strapiSvc = container.resolve(STRAPI_MODULE) as StrapiModuleService
  } catch {
    return order
  }

  const logger = (() => {
    try {
      return container.resolve("logger")
    } catch {
      return null
    }
  })()

  const titles = new Map<string, string>()
  for (const productId of productIds) {
    try {
      const product = await strapiSvc.findProductByMedusaId(productId)
      const title = product ? strapiTitleFromProduct(objectValue(product)) : null
      if (title) {
        titles.set(productId, title)
      }
    } catch (err) {
      logger?.warn?.(
        `[order-email] failed to load Strapi title for product=${productId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  if (!titles.size) {
    return order
  }

  return {
    ...order,
    items: rawItems.map((rawItem) => {
      const item = objectValue(rawItem)
      const productId = productIdForItem(item)
      const strapiTitle = productId ? titles.get(productId) : null
      if (!strapiTitle) {
        return rawItem
      }

      return {
        ...item,
        metadata: {
          ...objectValue(item.metadata),
          strapi_title: strapiTitle,
        },
      }
    }),
  }
}

const displayTitleForItem = (item: Record<string, any>): string => {
  const variant = objectValue(item.variant)
  const product = objectValue(item.product)
  const variantProduct = objectValue(variant.product)
  const metadata = objectValue(item.metadata)

  return (
    cleanText(metadata.strapi_title) ||
    cleanText(metadata.display_title) ||
    cleanText(metadata.customer_title) ||
    cleanText(metadata.medusa_product_title) ||
    cleanText(item.product_title) ||
    cleanText(variantProduct.title) ||
    cleanText(product.title) ||
    cleanText(variant.title) ||
    cleanText(item.title) ||
    "Griller's Pride item"
  )
}

const variantTitleForItem = (
  item: Record<string, any>,
  displayTitle: string
): string | null => {
  const variant = objectValue(item.variant)
  const product = objectValue(item.product)
  const variantProduct = objectValue(variant.product)
  const metadata = objectValue(item.metadata)
  const hasCustomerFacingTitle = Boolean(
    cleanText(metadata.strapi_title) ||
      cleanText(metadata.display_title) ||
      cleanText(metadata.customer_title)
  )

  if (hasCustomerFacingTitle) {
    return null
  }

  const title =
    cleanText(item.variant_title) ||
    cleanText(variant.title) ||
    cleanText(item.product_variant_title)

  const hiddenTitles = [
    displayTitle,
    item.title,
    item.subtitle,
    item.product_title,
    item.product_variant_title,
    product.title,
    variantProduct.title,
    "Default variant",
  ]
    .map((value) => cleanText(value)?.toLowerCase())
    .filter(Boolean)

  if (
    !title ||
    hiddenTitles.includes(title.toLowerCase()) ||
    looksLikeAccountingTitle(title)
  ) {
    return null
  }

  return title
}

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
    display_title?: string
    source_title?: string | null
    sku?: string | null
    quantity?: number
    unit_price?: number
    line_total?: number
    thumbnail?: string | null
    variant_title?: string | null
    product_title?: string | null
    variant?: {
      id?: string
      title?: string | null
      sku?: string | null
      product?: {
        id?: string
        title?: string | null
        thumbnail?: string | null
      } | null
    } | null
    detail?: {
      quantity?: number | string | null
    } | null
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
  payment_collections?: Array<{
    payments?: Array<{ provider_id?: string; amount?: number | string }>
  }>
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
  const order = orders?.[0] as Record<string, unknown> | undefined
  return order ? normalizeOrderForEmail(await hydrateStrapiTitles(container, order)) : null
}

export const normalizeOrderForEmail = (
  order: Record<string, unknown>
): OrderForEmail => {
  const rawItems = Array.isArray(order.items) ? order.items : []
  const items = rawItems.map((rawItem) => {
    const item = objectValue(rawItem)
    const detail = objectValue(item.detail)
    const variant = objectValue(item.variant)
    const variantProduct = objectValue(variant.product)
    const quantity = firstNumeric(
      item.quantity,
      detail.quantity,
      item.raw_quantity,
      detail.raw_quantity
    ) ?? 1
    const unitPrice = firstNumeric(item.unit_price, item.raw_unit_price)
    const computedLineTotal = unitPrice !== null ? unitPrice * quantity : null
    const lineSubtotal =
      firstPositiveNumeric(
        item.subtotal,
        item.item_subtotal,
        item.raw_subtotal,
        item.original_subtotal,
        computedLineTotal
      ) ??
      firstNumeric(
        item.subtotal,
        item.item_subtotal,
        item.raw_subtotal,
        item.original_subtotal,
        computedLineTotal
      ) ??
      firstPositiveNumeric(
        item.total,
        item.item_total,
        item.raw_total
      ) ??
      firstNumeric(
        item.total,
        item.item_total,
        item.raw_total
      ) ??
      0
    const effectiveUnitPrice =
      unitPrice !== null
        ? unitPrice
        : quantity > 0 && lineSubtotal > 0
          ? lineSubtotal / quantity
          : 0
    const displayTitle = displayTitleForItem(item)
    const sku = skuForItem(item)
    const thumbnail =
      cleanText(item.thumbnail) ||
      cleanText(variantProduct.thumbnail) ||
      cleanText(variant.thumbnail)

    return {
      ...item,
      id: String(item.id || ""),
      title: displayTitle,
      display_title: displayTitle,
      source_title: cleanText(item.title),
      sku,
      variant_title: variantTitleForItem(item, displayTitle),
      quantity,
      unit_price: effectiveUnitPrice,
      line_total: lineSubtotal,
      thumbnail,
    }
  })

  const itemSubtotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0)
  const shippingMethods = Array.isArray(order.shipping_methods)
    ? order.shipping_methods
    : []
  const shippingFromMethods = shippingMethods.reduce(
    (sum, method) => sum + (numeric(objectValue(method).amount) ?? 0),
    0
  )
  const shippingTotal =
    firstNumeric(order.shipping_total as MaybeMoney, order.shipping_subtotal as MaybeMoney) ??
    shippingFromMethods
  const discountTotal = firstNumeric(order.discount_total as MaybeMoney) ?? 0
  const paymentTotal = firstPositiveNumeric(
    ...(Array.isArray(order.payment_collections)
      ? order.payment_collections.flatMap((collection) =>
          Array.isArray(objectValue(collection).payments)
            ? objectValue(collection).payments.map(
                (payment: Record<string, unknown>) => payment.amount as MaybeMoney
              )
            : []
        )
      : [])
  )
  const explicitItemTotal = firstPositiveNumeric(order.item_total as MaybeMoney)
  const explicitItemSubtotal = firstPositiveNumeric(
    order.item_subtotal as MaybeMoney,
    order.subtotal as MaybeMoney
  )
  const derivedTaxTotal =
    explicitItemTotal !== null && explicitItemSubtotal !== null
      ? Math.max(0, explicitItemTotal - explicitItemSubtotal)
      : null
  const explicitTaxTotal = firstNumeric(
    order.tax_total as MaybeMoney,
    order.shipping_tax_total as MaybeMoney
  )
  const taxTotal =
    explicitTaxTotal !== null && explicitTaxTotal > 0
      ? explicitTaxTotal
      : derivedTaxTotal !== null && derivedTaxTotal > 0
        ? derivedTaxTotal
        : explicitTaxTotal ?? 0
  const subtotal =
    firstPositiveNumeric(
      order.item_subtotal as MaybeMoney,
      order.subtotal as MaybeMoney
    ) ??
    itemSubtotal
  const paymentDerivedTax =
    paymentTotal !== null
      ? Math.max(0, paymentTotal - subtotal - shippingTotal + discountTotal)
      : null
  const resolvedTaxTotal =
    taxTotal > 0
      ? taxTotal
      : paymentDerivedTax !== null && paymentDerivedTax > 0
        ? paymentDerivedTax
        : taxTotal
  const computedTotal = subtotal + shippingTotal + resolvedTaxTotal - discountTotal
  const total =
    paymentTotal ??
    (computedTotal > 0 &&
    (resolvedTaxTotal > 0 || shippingTotal > 0 || discountTotal > 0)
      ? computedTotal
      : firstPositiveNumeric(order.total as MaybeMoney) ?? computedTotal)

  return {
    ...(order as OrderForEmail),
    currency_code: String(order.currency_code || "usd"),
    items,
    subtotal,
    total,
    shipping_total: shippingTotal,
    tax_total: resolvedTaxTotal,
    discount_total: discountTotal,
  }
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
