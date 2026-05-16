import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { BACK_IN_STOCK_MODULE } from "../modules/back-in-stock"
import BackInStockModuleService from "../modules/back-in-stock/service"

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

export default async function backfillBackInStockInventoryState({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const backInStock = container.resolve(
    BACK_IN_STOCK_MODULE
  ) as BackInStockModuleService

  logger.info("[back-in-stock:backfill] loading inventory items")

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "sku",
      "title",
      "variants.id",
      "variants.sku",
      "variants.product.id",
      "variants.product.handle",
      "variants.product.status",
    ],
  })

  let observed = 0
  let failed = 0

  for (const item of inventoryItems) {
    try {
      const levels = await inventoryService.listInventoryLevels(
        { inventory_item_id: item.id },
        {
          select: [
            "id",
            "stocked_quantity",
            "reserved_quantity",
            "available_quantity",
          ],
        }
      )

      const availableQuantity = levels.reduce((sum: number, level: any) => {
        const available =
          level.available_quantity !== undefined &&
          level.available_quantity !== null
            ? numberValue(level.available_quantity)
            : numberValue(level.stocked_quantity) -
              numberValue(level.reserved_quantity)
        return sum + Math.max(0, available)
      }, 0)

      const variant = item.variants?.[0]
      await backInStock.observeInventoryState({
        inventoryItemId: item.id,
        availableQuantity,
        productId: variant?.product?.id,
        productHandle: variant?.product?.handle,
        variantId: variant?.id,
        sku: variant?.sku ?? item.sku,
      })
      observed += 1
    } catch (err) {
      failed += 1
      logger.error(
        `[back-in-stock:backfill] failed item ${item.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  logger.info(
    `[back-in-stock:backfill] done observed=${observed} failed=${failed} total=${inventoryItems.length}`
  )
}
