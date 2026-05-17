import Conductor from "conductor-node"
import { loadFirstExistingEnvFile } from "../scripts/lib/legacy-import-utils"

export type QbdItemFact = {
  type: string
  id: string
  name: string | null
  full_name: string | null
  is_active: boolean | null
  sales_description: string | null
  sales_price: string | null
}

export type QbdItemFactLookup =
  | {
      available: true
      reason: null
      item: QbdItemFact | null
    }
  | {
      available: false
      reason: string
      item: null
    }

const QBD_ITEM_RESOURCES = [
  "inventoryItems",
  "nonInventoryItems",
  "serviceItems",
  "itemGroups",
  "otherChargeItems",
]

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function salesDescription(item: any) {
  return toText(
    item.salesOrPurchaseDetails?.description ??
      item.salesAndPurchaseDetails?.salesDescription ??
      item.description
  )
}

function salesPrice(item: any) {
  return toText(
    item.salesOrPurchaseDetails?.price ??
      item.salesAndPurchaseDetails?.salesPrice ??
      item.salesPrice
  )
}

function ensureConductorEnv() {
  loadFirstExistingEnvFile([
    process.env.CONDUCTOR_ENV_FILE,
    process.env.ENV_FILE,
    ".env",
  ])

  if (
    !(process.env.CONDUCTOR_SECRET_KEY || process.env.CONDUCTOR_API_KEY) ||
    !process.env.CONDUCTOR_END_USER_ID
  ) {
    loadFirstExistingEnvFile(["../grillerspride/.env"])
  }

  const apiKey = process.env.CONDUCTOR_SECRET_KEY || process.env.CONDUCTOR_API_KEY
  const conductorEndUserId = process.env.CONDUCTOR_END_USER_ID

  return { apiKey, conductorEndUserId }
}

export async function retrieveQbdItemFact(
  qbdItemListId: string | null | undefined,
  options: {
    logger?: {
      warn?: (message: string) => void
    }
  } = {}
): Promise<QbdItemFactLookup> {
  const itemId = toText(qbdItemListId)
  if (!itemId) {
    return {
      available: false,
      reason: "missing_qbd_item_list_id",
      item: null,
    }
  }

  const { apiKey, conductorEndUserId } = ensureConductorEnv()
  if (!apiKey || !conductorEndUserId) {
    return {
      available: false,
      reason: "missing_conductor_env",
      item: null,
    }
  }

  const conductor = new Conductor({ apiKey })

  for (const resource of QBD_ITEM_RESOURCES) {
    try {
      const item = await (conductor.qbd as any)[resource].retrieve(itemId, {
        conductorEndUserId,
      })

      return {
        available: true,
        reason: null,
        item: {
          type: resource,
          id: toText(item.id) ?? itemId,
          name: toText(item.name),
          full_name: toText(item.fullName),
          is_active: typeof item.isActive === "boolean" ? item.isActive : null,
          sales_description: salesDescription(item),
          sales_price: salesPrice(item),
        },
      }
    } catch (error) {
      const status = (error as any)?.status
      if (status && [400, 404, 502].includes(status)) {
        continue
      }

      options.logger?.warn?.(
        `[legacy-qbd-item-facts] lookup failed id=${itemId} resource=${resource}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return {
    available: true,
    reason: null,
    item: null,
  }
}
