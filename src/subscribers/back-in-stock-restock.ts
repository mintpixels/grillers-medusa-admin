import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { BACK_IN_STOCK_MODULE } from "../modules/back-in-stock"
import BackInStockModuleService from "../modules/back-in-stock/service"
import StrapiModuleService, {
  BackInStockRequest,
} from "../modules/strapi/service"
import { STRAPI_MODULE } from "../modules/strapi"
import { buildBackInStockEmail } from "../lib/emails/templates/back-in-stock"

type InventoryLevelEvent = {
  id?: string
  inventory_item_id?: string
  location_id?: string
}

type VariantContext = {
  productId?: string | null
  productHandle?: string | null
  productTitle?: string | null
  productStatus?: string | null
  variantId?: string | null
  sku?: string | null
}

const MINIMUM_OOS_MS = 24 * 60 * 60 * 1000
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

function numberValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value && typeof (value as any).toNumber === "function") {
    return Number((value as any).toNumber())
  }
  if (value && typeof (value as any).valueOf === "function") {
    const parsed = Number((value as any).valueOf())
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function storefrontBaseUrl(): string {
  return (
    process.env.GRILLERS_STOREFRONT_URL ||
    process.env.STOREFRONT_URL ||
    "https://www.grillerspride.com"
  ).replace(/\/+$/, "")
}

function productUrl(handle?: string | null): string {
  if (!handle) {
    return `${storefrontBaseUrl()}/us`
  }
  return `${storefrontBaseUrl()}/us/products/${encodeURIComponent(handle)}`
}

function unsubscribeUrl(token: string): string {
  return `${storefrontBaseUrl()}/api/back-in-stock/unsubscribe?t=${encodeURIComponent(token)}`
}

async function resolveInventoryItemId(
  data: InventoryLevelEvent,
  inventoryService: any
): Promise<string | null> {
  if (data.inventory_item_id) {
    return data.inventory_item_id
  }
  if (!data.id) {
    return null
  }

  try {
    const level = await inventoryService.retrieveInventoryLevel(data.id, {
      select: ["id", "inventory_item_id"],
    })
    return level?.inventory_item_id ?? null
  } catch {
    return null
  }
}

async function totalAvailableForInventoryItem(
  inventoryItemId: string,
  inventoryService: any
): Promise<number> {
  const levels = await inventoryService.listInventoryLevels(
    { inventory_item_id: inventoryItemId },
    {
      select: [
        "id",
        "inventory_item_id",
        "location_id",
        "stocked_quantity",
        "reserved_quantity",
        "available_quantity",
      ],
    }
  )

  return levels.reduce((sum: number, level: any) => {
    const available =
      level.available_quantity !== undefined && level.available_quantity !== null
        ? numberValue(level.available_quantity)
        : numberValue(level.stocked_quantity) - numberValue(level.reserved_quantity)
    return sum + Math.max(0, available)
  }, 0)
}

async function loadVariantContext(
  inventoryItemId: string,
  query: any,
  logger: any
): Promise<VariantContext> {
  try {
    const { data } = await query.graph({
      entity: "inventory_item",
      fields: [
        "id",
        "sku",
        "title",
        "variants.id",
        "variants.sku",
        "variants.title",
        "variants.product.id",
        "variants.product.handle",
        "variants.product.title",
        "variants.product.status",
      ],
      filters: { id: inventoryItemId },
    })

    const item = data?.[0]
    const variant = item?.variants?.[0]
    const product = variant?.product

    return {
      productId: product?.id ?? null,
      productHandle: product?.handle ?? null,
      productTitle: product?.title ?? item?.title ?? null,
      productStatus: product?.status ?? null,
      variantId: variant?.id ?? null,
      sku: variant?.sku ?? item?.sku ?? null,
    }
  } catch (err) {
    logger.warn(
      `[back-in-stock] unable to load variant/product context for inventory item ${inventoryItemId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return {}
  }
}

async function sendAndMarkRequest(
  req: BackInStockRequest,
  ctx: VariantContext,
  restockEventKey: string,
  notificationModule: any,
  strapi: StrapiModuleService
): Promise<boolean> {
  const url = productUrl(ctx.productHandle ?? req.ProductHandle)
  const email = buildBackInStockEmail({
    productTitle: req.ProductTitle || ctx.productTitle || "your product",
    productUrl: url,
    unsubscribeUrl: unsubscribeUrl(req.UnsubscribeToken),
  })

  const notification = await notificationModule.createNotifications({
    to: req.Email,
    channel: "email",
    template: "back-in-stock-restocked",
    content: email,
    data: {
      medusa_product_id: ctx.productId ?? req.MedusaProductId,
      medusa_variant_id: ctx.variantId ?? req.MedusaVariantId ?? null,
      sku: ctx.sku ?? req.Sku ?? null,
      restock_event_key: restockEventKey,
      back_in_stock_request_id: req.documentId,
    },
  })

  await strapi.markBackInStockRequestNotified(req.documentId, {
    notifiedAt: new Date(),
    messageId: notification?.id,
    restockEventKey,
  })

  return true
}

export default async function backInStockRestockHandler({
  event: { data },
  container,
}: SubscriberArgs<InventoryLevelEvent>) {
  const logger = container.resolve("logger")
  const query = container.resolve("query")
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const notificationModule = container.resolve(Modules.NOTIFICATION) as any
  const backInStock = container.resolve(
    BACK_IN_STOCK_MODULE
  ) as BackInStockModuleService
  const strapi = container.resolve(STRAPI_MODULE) as StrapiModuleService

  const inventoryItemId = await resolveInventoryItemId(data, inventoryService)
  if (!inventoryItemId) {
    logger.warn("[back-in-stock] inventory event missing inventory_item_id")
    return
  }

  const [availableQuantity, context] = await Promise.all([
    totalAvailableForInventoryItem(inventoryItemId, inventoryService),
    loadVariantContext(inventoryItemId, query, logger),
  ])

  const observation = await backInStock.observeInventoryState({
    inventoryItemId,
    availableQuantity,
    productId: context.productId,
    productHandle: context.productHandle,
    variantId: context.variantId,
    sku: context.sku,
    minimumOutOfStockMs: MINIMUM_OOS_MS,
    cooldownMs: COOLDOWN_MS,
  })

  if (!observation.shouldNotify) {
    return
  }

  if (context.productStatus && context.productStatus !== "published") {
    logger.info(
      `[back-in-stock] ${inventoryItemId} restocked but product ${context.productId} is ${context.productStatus}; not notifying`
    )
    return
  }

  const requests = await strapi.findActiveBackInStockRequests({
    medusaProductId: context.productId,
    medusaVariantId: context.variantId,
    sku: context.sku,
  })

  if (!requests.length) {
    return
  }

  const restockEventKey = `${inventoryItemId}:${new Date().toISOString()}`
  await backInStock.markNotificationStarted(observation.state.id)

  let sent = 0
  let failed = 0
  for (const req of requests) {
    try {
      await sendAndMarkRequest(
        req,
        context,
        restockEventKey,
        notificationModule,
        strapi
      )
      sent += 1
    } catch (err) {
      failed += 1
      logger.error(
        `[back-in-stock] failed to notify request ${req.documentId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  await backInStock.markNotificationFinished(observation.state.id, sent)
  logger.info(
    `[back-in-stock] restock notifications inventory_item=${inventoryItemId} sent=${sent} failed=${failed}`
  )
}

export const config: SubscriberConfig = {
  event: [
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-level.restored",
  ],
}
