import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  legacyPurchaseDisplayTitle,
  legacyPurchaseHistoryKey,
  isCustomerVisibleLegacyLine,
} from "../lib/legacy-order-history"
import {
  getNumberArg,
  parseArgs,
} from "./lib/legacy-import-utils"

function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isGenericLegacyItemTitle(value: unknown) {
  return [
    "misc item",
    "miscellaneous item",
    "misc services",
    "misc service",
  ].includes(normalizeSearchText(value))
}

export default async function auditLegacyPurchaseHistoryGrouping({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const sampleLimit = getNumberArg(args, ["sample-limit"], 20)

  const rows = await db("legacy_order_line as lol")
    .join("legacy_order as lo", "lo.id", "lol.legacy_order_id")
    .select([
      "lol.id",
      "lol.qbd_item_list_id",
      "lol.sku",
      "lol.title",
      "lol.description",
      "lol.medusa_variant_id",
      "lol.medusa_variant_title",
      "lol.medusa_product_title",
      "lol.mapping_status",
      "lol.metadata",
      "lo.placed_at",
      "lo.medusa_customer_id",
    ])
    .whereNull("lol.deleted_at")
    .whereNull("lo.deleted_at")

  const visibleRows = rows.filter(isCustomerVisibleLegacyLine)
  const previousKeys = new Set<string>()
  const currentKeys = new Map<string, any>()
  const genericGroups = new Map<string, any>()

  for (const row of visibleRows) {
    previousKeys.add(
      row.medusa_variant_id ||
        row.qbd_item_list_id ||
        row.sku ||
        `legacy-line:${row.id}`
    )

    const key = legacyPurchaseHistoryKey(row)
    currentKeys.set(key, row)

    if (
      isGenericLegacyItemTitle(row.sku) ||
      isGenericLegacyItemTitle(row.title)
    ) {
      const existing = genericGroups.get(key)
      if (existing) {
        existing.count += 1
        continue
      }
      genericGroups.set(key, {
        key,
        sku: row.sku,
        title: row.title,
        displayTitle: legacyPurchaseDisplayTitle(row),
        count: 1,
      })
    }
  }

  const genericSamples = Array.from(genericGroups.values())
    .sort((a, b) => b.count - a.count || a.displayTitle.localeCompare(b.displayTitle))
    .slice(0, sampleLimit)

  logger.info(
    `[legacy-purchase-history-grouping] ${JSON.stringify({
      visibleRows: visibleRows.length,
      previousGroupedItems: previousKeys.size,
      currentGroupedItems: currentKeys.size,
      additionalItemsShown: currentKeys.size - previousKeys.size,
      genericVisibleGroups: genericGroups.size,
      genericSamples,
    })}`
  )
}
