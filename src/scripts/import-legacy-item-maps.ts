import path from "path"
import { readFile } from "fs/promises"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertLegacyItemMapping } from "../lib/legacy-item-mapping"
import {
  getBooleanArg,
  getStringArg,
  parseArgs,
  toText,
} from "./lib/legacy-import-utils"

type CsvRow = Record<string, string>

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim())
      current = ""
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function parseCsv(content: string): CsvRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))

  if (!lines.length) {
    return []
  }

  const headers = parseCsvLine(lines[0]).map((header) =>
    header.trim().toLowerCase()
  )

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line)
    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = cells[index]?.trim() ?? ""
      return row
    }, {})
  })
}

function rowValue(row: CsvRow, keys: string[]) {
  for (const key of keys) {
    const value = toText(row[key])
    if (value) {
      return value
    }
  }
  return null
}

export default async function importLegacyItemMaps({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const apply = getBooleanArg(args, ["apply"], false)
  const file = getStringArg(args, ["file", "csv"])
  const matchSkuWithQbdItemListId = getBooleanArg(
    args,
    ["match-sku-with-qbd-item-list-id", "match-sku-with-qbd-id"],
    false
  )

  if (!file) {
    throw new Error("Missing --file path to legacy item mapping CSV")
  }

  const sourceFile = path.resolve(process.cwd(), file)
  const rows = parseCsv(await readFile(sourceFile, "utf8"))
  const stats = {
    seen: rows.length,
    valid: 0,
    failed: 0,
    itemMapsUpserted: 0,
    matchRulesUpserted: 0,
    lineRowsBackfilled: 0,
  }

  for (const row of rows) {
    try {
      const result = await upsertLegacyItemMapping(db, {
        qbdItemListId: rowValue(row, [
          "qbd_item_list_id",
          "qbditemlistid",
          "quickbooks_item_id",
          "quickbooksitemid",
        ]),
        qbdName: rowValue(row, ["qbd_name", "quickbooks_name", "name"]),
        sku: rowValue(row, ["sku", "qbd_sku", "legacy_sku"]),
        descriptionContains: rowValue(row, [
          "description_contains",
          "line_description_contains",
          "description_pattern",
        ]),
        descriptionFingerprint: rowValue(row, [
          "description_fingerprint",
          "line_description_fingerprint",
        ]),
        medusaVariantId: rowValue(row, ["medusa_variant_id", "variant_id"]),
        medusaSku: rowValue(row, [
          "medusa_sku",
          "variant_sku",
          "target_sku",
        ]),
        confidence: rowValue(row, ["confidence"]),
        mappingSource: rowValue(row, ["mapping_source", "source"]) || "manual_csv",
        priority: rowValue(row, ["priority"]),
        sourceLabel: sourceFile,
        metadata: {
          imported_by: "import-legacy-item-maps",
        },
        dryRun: !apply,
        matchSkuWithQbdItemListId,
      })
      stats.valid += 1
      stats.itemMapsUpserted += result.itemMapUpserted ? 1 : 0
      stats.matchRulesUpserted += result.matchRuleUpserted ? 1 : 0
      stats.lineRowsBackfilled += result.lineRowsBackfilled
    } catch (error) {
      stats.failed += 1
      logger.error(
        `[legacy-item-maps] failed row: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  logger.info(
    `[legacy-item-maps] ${apply ? "applied" : "dry-run"} ${JSON.stringify(stats)}`
  )
}
