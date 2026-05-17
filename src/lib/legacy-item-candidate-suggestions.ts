type KnexLike = any

export type LegacyItemSuggestionInput = {
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  sample_description: string | null
  top_descriptions?: Array<{ description?: string | null }>
  line_count?: number
  description_count?: number
  last_ordered_at?: string | null
}

type VariantRow = {
  variant_id: string
  product_id: string | null
  sku: string | null
  variant_title: string | null
  product_title: string | null
  variant_metadata: Record<string, unknown> | null
  product_metadata: Record<string, unknown> | null
}

type IdentityGroup = {
  name: string
  terms: Array<{
    key: string
    patterns: RegExp[]
  }>
}

const STOP_WORDS = new Set([
  "a",
  "aka",
  "all",
  "and",
  "are",
  "at",
  "available",
  "brand",
  "by",
  "case",
  "contains",
  "for",
  "free",
  "from",
  "in",
  "is",
  "kosher",
  "lb",
  "lbs",
  "meat",
  "new",
  "no",
  "not",
  "of",
  "on",
  "or",
  "oz",
  "packed",
  "pack",
  "pareve",
  "per",
  "produced",
  "round",
  "serve",
  "serves",
  "supervision",
  "the",
  "to",
  "uncooked",
  "vacuum",
  "with",
  "year",
])

const IDENTITY_GROUPS: IdentityGroup[] = [
  {
    name: "poultry_part",
    terms: [
      {
        key: "8_piece_cut_up",
        patterns: [
          /\b(?:8|eight)[-\s]*(?:pce|pc|piece|pieces)\b/i,
          /\bcut[-\s]?up\b/i,
        ],
      },
      { key: "cornish_hen", patterns: [/\bcornish hens?\b/i] },
      { key: "whole", patterns: [/\bwhole\b/i] },
      { key: "neck", patterns: [/\bnecks?\b/i] },
      { key: "wing", patterns: [/\bwings?\b/i] },
      { key: "drumette", patterns: [/\bdrumettes?\b/i] },
      { key: "drumstick", patterns: [/\bdrumsticks?\b/i] },
      { key: "leg_quarter", patterns: [/\bleg quarters?\b/i] },
      { key: "thigh", patterns: [/\bthighs?\b/i] },
      { key: "breast", patterns: [/\bbreasts?\b/i] },
      { key: "liver", patterns: [/\blivers?\b/i] },
      { key: "bone", patterns: [/\bbones?\b(?![-\s]?in)\b/i] },
      { key: "ground", patterns: [/\bground\b/i] },
      { key: "schnitzel", patterns: [/\bschnitzel\b/i] },
      { key: "cutlet", patterns: [/\bcutlets?\b/i] },
      { key: "tender", patterns: [/\btenders?\b/i] },
      { key: "gizzard", patterns: [/\bgizzards?\b/i] },
    ],
  },
  {
    name: "beef_lamb_cut",
    terms: [
      { key: "london_broil", patterns: [/\blondon broil\b/i] },
      { key: "chuck_roast", patterns: [/\bchuck roast\b/i] },
      { key: "brisket", patterns: [/\bbrisket\b/i] },
      { key: "deckel", patterns: [/\bdeckel\b/i] },
      { key: "short_rib", patterns: [/\bshort ribs?\b/i] },
      { key: "flanken", patterns: [/\bflanken\b/i] },
      { key: "ribeye", patterns: [/\bribeye\b/i] },
      { key: "oyster", patterns: [/\boyster steak\b/i] },
      {
        key: "strip_denver",
        patterns: [/\bstrip steak\b/i, /\bdenver steak\b/i],
      },
      {
        key: "chuckeye_delmonico",
        patterns: [/\bchuckeye\b/i, /\bdelmonico\b/i],
      },
      {
        key: "biltong_jerky",
        patterns: [/\bbiltong\b/i, /\bbeef jerky\b/i],
      },
      { key: "dry_wors", patterns: [/\bdry wors\b/i, /\bdried sausage\b/i] },
      { key: "liver", patterns: [/\bliver\b/i] },
      { key: "pepper_steak", patterns: [/\bpepper steak\b/i] },
      { key: "minute_steak", patterns: [/\bminute steak\b/i] },
      { key: "kebab", patterns: [/\bkebabs?\b/i] },
    ],
  },
  {
    name: "preparation_state",
    terms: [
      { key: "raw_uncooked", patterns: [/\buncooked\b/i, /\braw\b/i] },
      { key: "grilled_cooked", patterns: [/\bgrilled\b/i, /\bcooked\b/i] },
      { key: "smoked", patterns: [/\bsmoked\b/i] },
      { key: "breaded", patterns: [/\bbreaded\b/i] },
    ],
  },
  {
    name: "bone_state",
    terms: [
      { key: "bone_in", patterns: [/\bbone[-\s]?in\b/i] },
      { key: "boneless", patterns: [/\bboneless\b/i] },
    ],
  },
  {
    name: "skin_state",
    terms: [
      { key: "skin_on", patterns: [/\bskin[-\s]?on\b/i] },
      { key: "skinless", patterns: [/\bskinless\b/i] },
    ],
  },
  {
    name: "prepared_item",
    terms: [
      { key: "pot_pie", patterns: [/\bpot pie\b/i] },
      { key: "pocket_pie", patterns: [/\bpocket pies?\b/i] },
      { key: "matzo_ball", patterns: [/\bmatzo balls?\b/i] },
      { key: "butternut_souffle", patterns: [/\bbutternut souffle\b/i] },
      { key: "corn_souffle", patterns: [/\bcorn souffle\b/i] },
      { key: "kugel", patterns: [/\bkugel\b/i] },
      { key: "gravy", patterns: [/\bgravy\b/i] },
      {
        key: "stuffing_dressing",
        patterns: [/\bstuffing\b/i, /\bdressing\b/i],
      },
      { key: "orange_chicken", patterns: [/\borange chicken\b/i] },
      { key: "meatballs", patterns: [/\bmeat ?balls?\b/i] },
      { key: "katsu", patterns: [/\bkatsu\b/i] },
      { key: "pulled_chicken", patterns: [/\bpulled chicken\b/i] },
      { key: "smoked_salmon", patterns: [/\bsmoked salmon\b/i] },
      { key: "turkey_pastrami", patterns: [/\bturkey pastrami\b/i] },
    ],
  },
  {
    name: "brand_or_program",
    terms: [
      { key: "david_elliot", patterns: [/\bdavid elliot\b/i] },
      { key: "empire", patterns: [/\bempire\b/i] },
      { key: "aarons", patterns: [/\baarons?\b/i] },
      { key: "organic", patterns: [/\borganic\b/i] },
      { key: "antibiotic_free", patterns: [/\bantibiotic[-\s]?free\b/i] },
      { key: "grass_fed", patterns: [/\bgrass[-\s]?fed\b/i] },
      { key: "american_angus", patterns: [/\bamerican angus\b/i] },
      { key: "haolam", patterns: [/\bhaolam\b/i] },
      { key: "bgan", patterns: [/\bb'?gan\b/i] },
    ],
  },
]

function toText(value: unknown): string | null {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function normalizeLookupValue(value: unknown) {
  return toText(value)?.toLowerCase() ?? null
}

function normalizeSkuValue(value: unknown) {
  return normalizeLookupValue(value)?.replace(/[^a-z0-9]/g, "") ?? null
}

function normalizeSearchText(value: unknown) {
  return (
    normalizeLookupValue(value)
      ?.replace(/&/g, " and ")
      .replace(/\$/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  )
}

function legacySkuAliases(value: unknown) {
  const text = toText(value)
  if (!text) {
    return []
  }

  const aliases = new Set<string>()
  const addAlias = (candidate: string | null | undefined) => {
    const normalized = toText(candidate)
    if (!normalized) {
      return
    }

    aliases.add(normalized)
    const trailingPassoverSuffix = normalized.match(/^(.+-[A-Z0-9]+)P$/i)
    if (trailingPassoverSuffix?.[1]) {
      aliases.add(trailingPassoverSuffix[1])
    }
  }

  addAlias(text)

  const legacyLifecyclePrefix = text.match(/^[XYZ]-(.+)$/i)
  if (legacyLifecyclePrefix?.[1]) {
    addAlias(legacyLifecyclePrefix[1])
  }

  return Array.from(aliases)
}

function extractSkuLikeValues(value: unknown) {
  const text = toText(value)
  if (!text) {
    return []
  }

  return (text.match(/\b[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,8}){1,5}\b/gi) ?? [])
    .filter((candidate) => /[a-z]/i.test(candidate))
}

function metadataValues(metadata: unknown, keys: string[]) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return []
  }

  const record = metadata as Record<string, unknown>
  return keys
    .flatMap((key) => {
      const value = record[key]
      return Array.isArray(value) ? value : [value]
    })
    .map(toText)
    .filter(Boolean) as string[]
}

function tokenSet(value: unknown) {
  const tokens = normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))

  return new Set(tokens)
}

function tokenSimilarity(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) {
    return 0
  }

  let intersection = 0
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1
    }
  }

  return intersection / (left.size + right.size - intersection)
}

function extractIdentityKeys(value: unknown, group: IdentityGroup) {
  const text = String(value ?? "")
  const keys = new Set<string>()

  for (const term of group.terms) {
    if (term.patterns.some((pattern) => pattern.test(text))) {
      keys.add(term.key)
    }
  }

  return keys
}

function setIntersects(left: Set<string>, right: Set<string>) {
  for (const value of left) {
    if (right.has(value)) {
      return true
    }
  }
  return false
}

function passoverStatus(value: unknown) {
  const text = normalizeSearchText(value)
  if (!text) {
    return null
  }

  if (/\bnot (?:kosher for passover|kfp)\b/.test(text)) {
    return "not_kfp"
  }
  if (/\b(?:kosher for passover|kfp)\b/.test(text)) {
    return "kfp"
  }

  return null
}

export function legacyItemIdentityWarnings(
  legacyText: string,
  candidateText: string
) {
  const warnings: string[] = []
  const legacyPassoverStatus = passoverStatus(legacyText)
  const candidatePassoverStatus = passoverStatus(candidateText)
  if (
    legacyPassoverStatus &&
    candidatePassoverStatus &&
    legacyPassoverStatus !== candidatePassoverStatus
  ) {
    warnings.push(
      `passover_status:${legacyPassoverStatus}->${candidatePassoverStatus}`
    )
  }

  for (const group of IDENTITY_GROUPS) {
    const legacyKeys = extractIdentityKeys(legacyText, group)
    const candidateKeys = extractIdentityKeys(candidateText, group)
    if (
      legacyKeys.size &&
      candidateKeys.size &&
      !setIntersects(legacyKeys, candidateKeys)
    ) {
      warnings.push(
        `${group.name}:${Array.from(legacyKeys).sort().join("+")}->${Array.from(candidateKeys).sort().join("+")}`
      )
    }
  }

  return warnings
}

function legacyTextForSuggestion(item: LegacyItemSuggestionInput) {
  return [
    item.title,
    item.sample_description,
    ...(item.top_descriptions ?? []).map((description) => description.description),
  ]
    .filter(Boolean)
    .join(" ")
}

function scoreVariantSuggestion(
  item: LegacyItemSuggestionInput,
  variant: VariantRow
) {
  const reasons: string[] = []
  let score = 0
  const legacySkuCandidates = legacySkuAliases(item.sku)
  const variantSku = normalizeSkuValue(variant.sku)

  if (variantSku) {
    for (const candidate of legacySkuCandidates) {
      if (normalizeSkuValue(candidate) === variantSku) {
        score = Math.max(score, 0.98)
        reasons.push("sku_alias_exact")
      }
    }
  }

  const descriptionSkuCandidates = extractSkuLikeValues(item.sample_description)
  if (variantSku) {
    for (const candidate of descriptionSkuCandidates) {
      const normalizedCandidate = normalizeSkuValue(candidate)
      if (normalizedCandidate && variantSku.endsWith(normalizedCandidate)) {
        score = Math.max(score, 0.95)
        reasons.push("description_sku_variant_suffix_exact")
      }
    }
  }

  const legacyMetadataKeys = [
    "qbd_item_list_id",
    "qbdItemListId",
    "quickbooks_item_id",
    "quickbooksItemId",
    "quickbooks_list_id",
    "quickbooksListId",
    "legacy_item_id",
    "legacyItemId",
    "legacy_sku",
    "legacySku",
    "item_code",
    "itemCode",
    "sku",
  ]
  const legacyValues = [
    ...metadataValues(variant.variant_metadata, legacyMetadataKeys),
    ...metadataValues(variant.product_metadata, legacyMetadataKeys),
  ].map(normalizeSkuValue)
  const itemValues = [
    item.qbd_item_list_id,
    item.sku,
    ...legacySkuCandidates,
  ].map(normalizeSkuValue)

  if (itemValues.some((value) => value && legacyValues.includes(value))) {
    score = Math.max(score, 0.99)
    reasons.push("legacy_metadata_exact")
  }

  const legacyText = legacyTextForSuggestion(item)
  const variantText = [
    variant.sku,
    variant.variant_title,
    variant.product_title,
  ]
    .filter(Boolean)
    .join(" ")
  const legacyTokens = tokenSet(legacyText)
  const variantTokens = tokenSet(variantText)
  const similarity = tokenSimilarity(legacyTokens, variantTokens)

  if (similarity >= 0.28) {
    score = Math.max(score, 0.45 + similarity * 0.5)
    reasons.push(`token_similarity:${similarity.toFixed(3)}`)
  }

  const normalizedLegacyDescription = normalizeSearchText(item.sample_description)
  const normalizedProductTitle = normalizeSearchText(variant.product_title)
  if (
    normalizedProductTitle.length >= 16 &&
    normalizedLegacyDescription.includes(normalizedProductTitle)
  ) {
    score = Math.max(score, 0.86)
    reasons.push("product_title_contained")
  }

  if (!score) {
    return null
  }

  const warnings = legacyItemIdentityWarnings(legacyText, variantText)
  const hasExactReason = reasons.some((reason) => reason.endsWith("_exact"))
  if (warnings.length && !hasExactReason) {
    return null
  }

  if (warnings.length) {
    score = Math.min(score, 0.94)
  }

  const roundedScore = Number(score.toFixed(4))
  const reviewStatus =
    !warnings.length &&
    roundedScore >= 0.97 &&
    (item.description_count ?? 0) <= 1 &&
    hasExactReason
      ? "high_confidence"
      : "review_required"

  return {
    variant_id: variant.variant_id,
    sku: variant.sku,
    variant_title: variant.variant_title,
    product_id: variant.product_id,
    product_title: variant.product_title,
    score: roundedScore,
    reasons,
    identity_warnings: warnings,
    review_status: reviewStatus,
  }
}

export async function suggestLegacyItemMappings(
  db: KnexLike,
  item: LegacyItemSuggestionInput,
  options: { limit?: number; minScore?: number } = {}
)
{
  const limit = Math.min(Math.max(Number(options.limit) || 8, 1), 20)
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : 0.45

  const variants = (await db("product_variant as pv")
    .leftJoin("product as p", "p.id", "pv.product_id")
    .select([
      "pv.id as variant_id",
      "pv.sku as sku",
      "pv.title as variant_title",
      "pv.product_id as product_id",
      "pv.metadata as variant_metadata",
      "p.title as product_title",
      "p.metadata as product_metadata",
    ])
    .whereNull("pv.deleted_at")
    .where((builder: any) => {
      builder.whereNull("p.deleted_at").orWhereNull("p.id")
    })) as VariantRow[]

  return variants
    .map((variant) => scoreVariantSuggestion(item, variant))
    .filter((suggestion): suggestion is NonNullable<typeof suggestion> =>
      Boolean(suggestion && suggestion.score >= minScore)
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
