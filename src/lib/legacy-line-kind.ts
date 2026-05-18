export type LegacyLineKind =
  | "product"
  | "subtotal"
  | "fee"
  | "discount"
  | "fulfillment"
  | "service"
  | "note"
  | "adjustment"
  | "non_product"
  | (string & {})

export function normalizeLegacySearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function isGenericLegacyItemTitle(value: unknown) {
  const normalized = normalizeLegacySearchText(value)
  return [
    "misc item",
    "miscellaneous item",
    "miscellanous item",
    "misc services",
    "misc service",
  ].includes(normalized)
}

function normalizeText(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized.length ? normalized : null
}

function extractSkuLikeValues(value: unknown) {
  const text = normalizeText(value)
  if (!text) {
    return []
  }

  return (text.match(/\b[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,8}){1,5}\b/gi) ?? [])
    .filter((candidate) => /[a-z]/i.test(candidate))
}

function metadataLineKind(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null
  }

  return normalizeText((metadata as Record<string, unknown>).line_kind)
}

export function classifyLegacyLineKind(input: {
  qbdItemListId?: string | null
  sku?: string | null
  title?: string | null
  description?: string | null
  qbdItemFullName?: string | null
  lineTotal?: number | string | null
  metadata?: unknown
  mappingStatus?: string | null
}): LegacyLineKind {
  const metadataKind = metadataLineKind(input.metadata)
  if (metadataKind && metadataKind !== "product") {
    return metadataKind
  }

  if (input.mappingStatus === "non_product") {
    return "non_product"
  }

  const sku = normalizeLegacySearchText(input.sku)
  const title = normalizeLegacySearchText(input.title)
  const description = normalizeLegacySearchText(input.description)
  const qbdName = normalizeLegacySearchText(input.qbdItemFullName)
  const rawDescription = String(input.description ?? "").trim().toLowerCase()
  const blob = [sku, title, description, qbdName].filter(Boolean).join(" ")
  const isGenericLegacyItem =
    isGenericLegacyItemTitle(input.sku) ||
    isGenericLegacyItemTitle(input.title) ||
    isGenericLegacyItemTitle(input.qbdItemFullName)

  if (!blob) {
    return "note"
  }

  if (
    isGenericLegacyItem &&
    (!description || isGenericLegacyItemTitle(input.description))
  ) {
    return "note"
  }

  if (
    sku === "subtotal" ||
    title === "subtotal" ||
    blob.includes(" subtotal ")
  ) {
    return "subtotal"
  }

  if (
    /\bgift\s+(certificate|cert|voucher|card)\b/.test(blob) ||
    /\b(certificate|voucher)\s+\d+\b/.test(blob) ||
    /\bdonation\b/.test(blob) ||
    /\btzedakah\b/.test(blob)
  ) {
    return "non_product"
  }

  if (
    blob.includes("sales tax") ||
    blob.includes("cty sales tax") ||
    blob.includes("county sales tax")
  ) {
    return "fee"
  }

  if (
    blob.includes("bad check") ||
    blob.includes("returned check") ||
    blob.includes("bad debt") ||
    (isGenericLegacyItem &&
      (description.includes("cc dispute") ||
        description.includes("chargeback") ||
        description.includes("rebill") ||
        description.includes("order already charged") ||
        (description.includes("applied to") &&
          description.includes("instead")) ||
        description.includes("put under wrong") ||
        description.includes("wrong account") ||
        (description.includes("charged") &&
          description.includes("instead")) ||
        (description.includes("moved to") &&
          description.includes("account")) ||
        description.includes("received wrong product") ||
        description.includes("did not want") ||
        description === "venmo" ||
        description === "fix" ||
        /^(miscellaneous item\s*)?[a-z][a-z\s.'-]{1,80}\s+inv\s+\d+$/.test(description)))
  ) {
    return "adjustment"
  }

  if (blob.includes("staff allowance")) {
    return "note"
  }

  if (
    blob.includes("bulk case repack") ||
    blob.includes("repack charge") ||
    blob.includes("repacking charge") ||
    blob.includes("repacking case") ||
    blob.includes("repack surcharge") ||
    blob.includes("cut pack charge") ||
    blob.includes("cut and pack charge") ||
    blob.includes("custom slicing") ||
    blob.includes("trimming of fat") ||
    blob.includes("additional labor")
  ) {
    return "service"
  }

  if (
    sku === "ccc" ||
    title === "ccc" ||
    blob.includes("credit debit") ||
    blob.includes("credit card") ||
    blob.includes("processing recovery fee") ||
    blob.includes("card processing") ||
    blob.includes("admin fee") ||
    (isGenericLegacyItem &&
      (/\b(pay|paid|paying|payment|cash|check|card)\b/.test(description) ||
        /\bcommis?sion\b/.test(description) ||
        /^\s*(miscellaneous item[-,\s]*)?\d+(?:\.\d+)?\s*%?\s*$/.test(rawDescription)))
  ) {
    return "fee"
  }

  if (
    blob.includes("discount") ||
    blob.includes("coupon") ||
    blob.includes("refund") ||
    /\bcredit\b/.test(blob)
  ) {
    return "discount"
  }

  if (
    sku === "pick up" ||
    sku === "pickup" ||
    title === "pick up" ||
    title === "pickup" ||
    sku.startsWith("del ") ||
    title.startsWith("del ") ||
    blob.includes(" ups ") ||
    blob.startsWith("ups ") ||
    blob.includes(" fedex ") ||
    blob.startsWith("fedex ") ||
    blob.includes("fedexground") ||
    blob.includes("fedexovernight") ||
    blob.includes("ground shipping") ||
    blob.includes("ups ground") ||
    blob.includes("usps") ||
    blob.includes("postal") ||
    blob.includes("flat rate box") ||
    /\bfrb\d*\b/.test(blob) ||
    blob.includes("dry ice") ||
    blob.includes("customer pick up") ||
    blob.includes("local pickup") ||
    blob.includes("freight") ||
    blob.includes("shipping") ||
    blob.includes("delivery charge") ||
    description === "delivery" ||
    description.startsWith("delivery ")
  ) {
    return "fulfillment"
  }

  if (
    isGenericLegacyItem &&
    (description.includes("invoice") ||
      description.includes("recharge") ||
      description.includes("gratuity") ||
      description.includes("surcharge") ||
      description.includes("prices are extremely volatile") ||
      description.includes("stamp charge") ||
      description.startsWith("please note") ||
      description === "tip" ||
      description.startsWith("tip ") ||
      /\bdriver'?s?\s+tip\b/.test(description) ||
      /\bdon\s+tip\b/.test(description) ||
      /\bstamps?\b/.test(description) ||
      description.startsWith("actual weight") ||
      /\bshopping bags?\b/.test(description) ||
      /^miscellaneous item \d+ items?$/.test(description))
  ) {
    return "note"
  }

  if (
    !input.qbdItemListId &&
    input.lineTotal !== undefined &&
    input.lineTotal !== null &&
    Number(input.lineTotal) === 0
  ) {
    return "note"
  }

  if (
    !input.mappingStatus &&
    !extractSkuLikeValues(input.sku).length &&
    !input.qbdItemListId
  ) {
    return "adjustment"
  }

  return "product"
}
