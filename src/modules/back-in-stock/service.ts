import { MedusaError, MedusaService } from "@medusajs/framework/utils"
import BackInStockInventoryState from "./models/inventory-state"

type VariantContext = {
  productId?: string | null
  productHandle?: string | null
  variantId?: string | null
  sku?: string | null
}

type InventoryObservationInput = VariantContext & {
  inventoryItemId: string
  availableQuantity: number
  observedAt?: Date
  minimumOutOfStockMs?: number
  cooldownMs?: number
}

type InventoryObservationResult = {
  state: any
  previousAvailableQuantity: number | null
  availableQuantity: number
  becameInStock: boolean
  wasOutOfStockLongEnough: boolean
  isOutsideCooldown: boolean
  shouldNotify: boolean
}

const DEFAULT_MINIMUM_OOS_MS = 24 * 60 * 60 * 1000
const DEFAULT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

class BackInStockModuleService extends MedusaService({
  BackInStockInventoryState,
}) {
  async observeInventoryState(
    input: InventoryObservationInput
  ): Promise<InventoryObservationResult> {
    if (!input.inventoryItemId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "inventoryItemId is required"
      )
    }

    const observedAt = input.observedAt ?? new Date()
    const availableQuantity = Math.max(0, Number(input.availableQuantity || 0))
    const isInStock = availableQuantity > 0
    const minimumOutOfStockMs =
      input.minimumOutOfStockMs ?? DEFAULT_MINIMUM_OOS_MS
    const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS

    const existing = (
      await this.listBackInStockInventoryStates(
        { inventory_item_id: input.inventoryItemId },
        { take: 1 }
      )
    )[0]

    const previousAvailableQuantity =
      existing?.available_quantity === undefined ||
      existing?.available_quantity === null
        ? null
        : Number(existing.available_quantity)
    const previouslyInStock =
      existing?.was_in_stock ??
      (previousAvailableQuantity !== null && previousAvailableQuantity > 0)

    let outOfStockSince = existing?.out_of_stock_since
      ? new Date(existing.out_of_stock_since)
      : null
    if (!isInStock && !outOfStockSince) {
      outOfStockSince = observedAt
    }

    const becameInStock = isInStock && !previouslyInStock
    const wasOutOfStockLongEnough =
      becameInStock &&
      !!outOfStockSince &&
      observedAt.getTime() - outOfStockSince.getTime() >= minimumOutOfStockMs

    const lastRestockedAt = existing?.last_restocked_at
      ? new Date(existing.last_restocked_at)
      : null
    const isOutsideCooldown =
      !lastRestockedAt ||
      observedAt.getTime() - lastRestockedAt.getTime() >= cooldownMs

    const payload = {
      inventory_item_id: input.inventoryItemId,
      product_id: input.productId ?? existing?.product_id ?? null,
      product_handle: input.productHandle ?? existing?.product_handle ?? null,
      variant_id: input.variantId ?? existing?.variant_id ?? null,
      sku: input.sku ?? existing?.sku ?? null,
      available_quantity: availableQuantity,
      was_in_stock: isInStock,
      out_of_stock_since: isInStock ? null : outOfStockSince,
      last_restocked_at: becameInStock ? observedAt : lastRestockedAt,
      last_seen_at: observedAt,
      metadata: {
        ...(existing?.metadata ?? {}),
        previous_available_quantity: previousAvailableQuantity,
        observed_at: observedAt.toISOString(),
      },
    }

    const state = existing
      ? await this.updateBackInStockInventoryStates({
          id: existing.id,
          ...payload,
        })
      : await this.createBackInStockInventoryStates(payload)

    return {
      state,
      previousAvailableQuantity,
      availableQuantity,
      becameInStock,
      wasOutOfStockLongEnough,
      isOutsideCooldown,
      shouldNotify:
        becameInStock && wasOutOfStockLongEnough && isOutsideCooldown,
    }
  }

  async markNotificationStarted(id: string, startedAt = new Date()) {
    return await this.updateBackInStockInventoryStates({
      id,
      last_notification_started_at: startedAt,
    })
  }

  async markNotificationFinished(
    id: string,
    count: number,
    finishedAt = new Date()
  ) {
    return await this.updateBackInStockInventoryStates({
      id,
      last_notification_finished_at: finishedAt,
      last_notification_count: count,
    })
  }
}

export default BackInStockModuleService
