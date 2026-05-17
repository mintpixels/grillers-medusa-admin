import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentText } from "@medusajs/icons"
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Table,
  Text,
  Textarea,
} from "@medusajs/ui"
import { FormEvent, useEffect, useMemo, useState } from "react"

type LegacyItemMappingCandidate = {
  key: string
  qbd_item_list_id: string | null
  sku: string | null
  title: string | null
  description_group: string | null
  sample_description: string | null
  top_descriptions: Array<{
    description: string
    line_count: number
    order_count: number
    last_ordered_at: string | null
  }>
  line_count: number
  order_count: number
  customer_count: number
  total_quantity: number
  last_ordered_at: string | null
  last_order_ref: string | null
  last_customer_name: string | null
  description_count: number
  requires_description_matcher: boolean
  suggested_description_contains: string | null
}

type CandidateListResponse = {
  candidates: LegacyItemMappingCandidate[]
  count: number
  limit: number
  offset: number
  min_lines: number
}

type MappingResult = {
  dry_run?: boolean
  result: {
    lineRowsBackfilled: number
    itemMapUpserted: boolean
    matchRuleUpserted: boolean
    variant: {
      variant_id: string
      sku: string | null
      product_title: string | null
      variant_title: string | null
    }
  }
}

type VariantSearchResult = {
  variant_id: string
  sku: string | null
  variant_title: string | null
  product_id: string | null
  product_title: string | null
}

type VariantSearchResponse = {
  variants: VariantSearchResult[]
}

type VariantSuggestion = VariantSearchResult & {
  score: number
  reasons: string[]
  identity_warnings: string[]
  review_status: "high_confidence" | "review_required" | string
}

type QbdItemFact = {
  type: string
  id: string
  name: string | null
  full_name: string | null
  is_active: boolean | null
  sales_description: string | null
  sales_price: string | null
}

type QbdItemLookupStatus = {
  available: boolean
  reason: string | null
}

type VariantSuggestionResponse = {
  suggestions: VariantSuggestion[]
  qbd_item?: QbdItemFact | null
  qbd_item_lookup?: QbdItemLookupStatus
}

function formatDate(value: string | null) {
  if (!value) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}

function itemTitle(candidate: LegacyItemMappingCandidate | null) {
  if (!candidate) {
    return "Legacy item"
  }

  return (
    candidate.title ||
    candidate.sample_description ||
    candidate.sku ||
    candidate.qbd_item_list_id ||
    "Legacy item"
  )
}

function historySearchTerm(candidate: LegacyItemMappingCandidate) {
  return (
    candidate.last_order_ref ||
    candidate.sample_description ||
    candidate.sku ||
    candidate.qbd_item_list_id ||
    itemTitle(candidate)
  )
}

const LegacyItemMappingPage = () => {
  const [query, setQuery] = useState("")
  const [minLines, setMinLines] = useState("10")
  const [candidates, setCandidates] = useState<LegacyItemMappingCandidate[]>([])
  const [count, setCount] = useState(0)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [targetSku, setTargetSku] = useState("")
  const [targetVariantId, setTargetVariantId] = useState("")
  const [variantQuery, setVariantQuery] = useState("")
  const [variantResults, setVariantResults] = useState<VariantSearchResult[]>([])
  const [isSearchingVariants, setIsSearchingVariants] = useState(false)
  const [variantSuggestions, setVariantSuggestions] = useState<VariantSuggestion[]>([])
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [qbdItemFact, setQbdItemFact] = useState<QbdItemFact | null>(null)
  const [qbdItemLookup, setQbdItemLookup] = useState<QbdItemLookupStatus | null>(null)
  const [descriptionContains, setDescriptionContains] = useState("")
  const [staffNote, setStaffNote] = useState("")
  const [preview, setPreview] = useState<MappingResult | null>(null)
  const [previewKey, setPreviewKey] = useState("")

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.key === selectedKey) ?? null,
    [candidates, selectedKey]
  )

  async function fetchCandidates(search = query) {
    setIsLoading(true)
    setError(null)

    const params = new URLSearchParams({
      limit: "50",
      offset: "0",
      min_lines: minLines || "1",
    })
    if (search.trim()) {
      params.set("q", search.trim())
    }

    try {
      const response = await fetch(
        `/admin/legacy-item-mapping-candidates?${params}`,
        { credentials: "include" }
      )
      const body = (await response.json().catch(() => ({}))) as
        | Partial<CandidateListResponse>
        | { message?: string }
      if (!response.ok || !("candidates" in body)) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : `Request failed with ${response.status}`
        )
      }

      setCandidates(body.candidates || [])
      setCount(body.count || 0)
      setSelectedKey((current) => {
        if (current && body.candidates?.some((candidate) => candidate.key === current)) {
          return current
        }

        return body.candidates?.[0]?.key ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchCandidates("")
  }, [])

  useEffect(() => {
    if (!selected) {
      setTargetSku("")
      setTargetVariantId("")
      setDescriptionContains("")
      setStaffNote("")
      setVariantSuggestions([])
      setQbdItemFact(null)
      setQbdItemLookup(null)
      return
    }

    setTargetSku("")
    setTargetVariantId("")
    setVariantQuery("")
    setVariantResults([])
    setVariantSuggestions([])
    setQbdItemFact(null)
    setQbdItemLookup(null)
    setDescriptionContains(selected.suggested_description_contains || "")
    setStaffNote("")
    setPreview(null)
    setPreviewKey("")
    setResult(null)
    void fetchVariantSuggestions(selected)
  }, [selectedKey, selected])

  useEffect(() => {
    setPreview(null)
    setPreviewKey("")
  }, [targetSku, targetVariantId, descriptionContains, staffNote])

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void fetchCandidates()
  }

  function mappingPayload(dryRun: boolean) {
    return {
      qbd_item_list_id: selected?.qbd_item_list_id,
      sku: selected?.sku,
      title: selected?.title,
      description_group: selected?.description_group,
      medusa_sku: targetSku,
      medusa_variant_id: targetVariantId,
      description_contains: descriptionContains,
      staff_note: staffNote,
      dry_run: dryRun,
    }
  }

  function currentPreviewKey() {
    return JSON.stringify(mappingPayload(false))
  }

  async function fetchVariantSuggestions(candidate: LegacyItemMappingCandidate) {
    setIsLoadingSuggestions(true)

    try {
      const response = await fetch(
        `/admin/legacy-item-mapping-candidates/suggestions`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            qbd_item_list_id: candidate.qbd_item_list_id,
            sku: candidate.sku,
            title: candidate.title,
            description_group: candidate.description_group,
            limit: 6,
            min_score: 0.45,
          }),
        }
      )
      const body = (await response.json().catch(() => ({}))) as
        | Partial<VariantSuggestionResponse>
        | { message?: string }
      if (!response.ok || !("suggestions" in body)) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : `Request failed with ${response.status}`
        )
      }

      setVariantSuggestions(body.suggestions || [])
      setQbdItemFact(body.qbd_item || null)
      setQbdItemLookup(body.qbd_item_lookup || null)
    } catch (err) {
      setVariantSuggestions([])
      setQbdItemFact(null)
      setQbdItemLookup(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoadingSuggestions(false)
    }
  }

  async function searchVariants(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (!variantQuery.trim()) {
      setVariantResults([])
      return
    }

    setIsSearchingVariants(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        q: variantQuery.trim(),
        limit: "12",
      })
      const response = await fetch(
        `/admin/legacy-item-mapping-candidates/variants?${params}`,
        { credentials: "include" }
      )
      const body = (await response.json().catch(() => ({}))) as
        | Partial<VariantSearchResponse>
        | { message?: string }
      if (!response.ok || !("variants" in body)) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : `Request failed with ${response.status}`
        )
      }

      setVariantResults(body.variants || [])
      if (!body.variants?.length) {
        setResult("No current catalog variants matched that search.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSearchingVariants(false)
    }
  }

  function selectVariant(variant: VariantSearchResult) {
    setTargetSku(variant.sku || "")
    setTargetVariantId(variant.variant_id)
    setVariantQuery(
      [variant.product_title, variant.variant_title, variant.sku]
        .filter(Boolean)
        .join(" / ")
    )
    setVariantResults([])
  }

  async function previewMapping() {
    if (!selected) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)
    setPreview(null)
    setPreviewKey("")

    try {
      const response = await fetch(`/admin/legacy-item-mapping-candidates/map`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mappingPayload(true)),
      })
      const body = (await response.json().catch(() => ({}))) as
        | Partial<MappingResult>
        | { message?: string }
      if (!response.ok || !("result" in body) || !body.result) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : `Request failed with ${response.status}`
        )
      }

      setPreview(body as MappingResult)
      setPreviewKey(currentPreviewKey())
      setResult("Preview ready. Confirm the target before approving.")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function approveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return

    if (!preview || previewKey !== currentPreviewKey()) {
      setError("Preview this exact mapping before approving it.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`/admin/legacy-item-mapping-candidates/map`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mappingPayload(false)),
      })
      const body = (await response.json().catch(() => ({}))) as
        | Partial<MappingResult>
        | { message?: string }
      if (!response.ok || !("result" in body)) {
        throw new Error(
          "message" in body && body.message
            ? body.message
            : `Request failed with ${response.status}`
        )
      }

      const rows = body.result?.lineRowsBackfilled ?? 0
      setResult(`Mapped ${rows} historical line${rows === 1 ? "" : "s"}.`)
      setPreview(null)
      setPreviewKey("")
      await fetchCandidates()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <Heading>Legacy Item Mapping</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Proactively map unmapped QuickBooks product history into current Medusa variants.
          </Text>
        </div>
        <Badge color="grey">{count} groups</Badge>
      </div>

      <form
        className="grid grid-cols-[minmax(0,1fr)_130px_auto] gap-2 px-6 py-4"
        onSubmit={onSearch}
      >
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Legacy item, description, SKU, customer, invoice..."
        />
        <Input
          value={minLines}
          onChange={(event) => setMinLines(event.target.value)}
          placeholder="Min lines"
          type="number"
        />
        <Button isLoading={isLoading} type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error && (
        <div className="px-6 py-3">
          <Text className="text-ui-fg-error" size="small">
            {error}
          </Text>
        </div>
      )}
      {result && (
        <div className="px-6 py-3">
          <Text className="text-ui-fg-success" size="small">
            {result}
          </Text>
        </div>
      )}

      <div className="grid min-h-[680px] grid-cols-[minmax(0,1fr)_460px]">
        <div className="border-r">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Legacy item</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Lines</Table.HeaderCell>
                <Table.HeaderCell className="text-right">Customers</Table.HeaderCell>
                <Table.HeaderCell>Last ordered</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {candidates.map((candidate) => (
                <Table.Row
                  className="cursor-pointer"
                  key={candidate.key}
                  onClick={() => setSelectedKey(candidate.key)}
                >
                  <Table.Cell>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <Text weight="plus">{itemTitle(candidate)}</Text>
                        {candidate.requires_description_matcher && (
                          <Badge color="orange">Scoped</Badge>
                        )}
                      </div>
                      <Text className="text-ui-fg-subtle" size="small">
                        {candidate.sku
                          ? `SKU ${candidate.sku}`
                          : candidate.qbd_item_list_id || "Description group"}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {candidate.line_count}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    {candidate.customer_count}
                  </Table.Cell>
                  <Table.Cell>{formatDate(candidate.last_ordered_at)}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>

        <aside className="flex flex-col">
          {selected ? (
            <>
              <div className="border-b px-6 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Unmapped history group
                    </Text>
                    <Heading level="h2">{itemTitle(selected)}</Heading>
                  </div>
                  {selected.requires_description_matcher && (
                    <Badge color="orange">Matcher required</Badge>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Historical lines
                    </Text>
                    <Text>{selected.line_count}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Orders
                    </Text>
                    <Text>{selected.order_count}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Customers
                    </Text>
                    <Text>{selected.customer_count}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Last ordered
                    </Text>
                    <Text>{formatDate(selected.last_ordered_at)}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Legacy item
                    </Text>
                    <Text>{selected.qbd_item_list_id || selected.sku || "Description rule"}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Descriptions
                    </Text>
                    <Text>{selected.description_count}</Text>
                  </div>
                </div>

                <a
                  className="mt-4 inline-flex text-ui-fg-interactive"
                  href={`/app/legacy-orders?q=${encodeURIComponent(historySearchTerm(selected))}`}
                >
                  Open matching historical orders
                </a>
              </div>

              <form className="space-y-4 overflow-auto px-6 py-4" onSubmit={approveMapping}>
                <div className="space-y-2">
                  <Text size="small" weight="plus">
                    Common historical descriptions
                  </Text>
                  <div className="max-h-44 overflow-auto rounded-md border border-ui-border-base">
                    {selected.top_descriptions.map((description) => (
                      <button
                        className="flex w-full flex-col border-b border-ui-border-base px-3 py-2 text-left last:border-b-0 hover:bg-ui-bg-subtle"
                        key={`${description.description}-${description.line_count}`}
                        onClick={() => setDescriptionContains(description.description)}
                        type="button"
                      >
                        <Text>{description.description}</Text>
                        <Text className="text-ui-fg-subtle" size="small">
                          {description.line_count} lines / {description.order_count} orders / last {formatDate(description.last_ordered_at)}
                        </Text>
                      </button>
                    ))}
                  </div>
                </div>

                {selected.requires_description_matcher && (
                  <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                    <Text size="small" weight="plus">
                      Description matcher required
                    </Text>
                    <Text className="text-ui-fg-subtle" size="small">
                      This group came from a generic QuickBooks bucket. Approvals create a scoped match rule instead of mapping the whole bucket.
                    </Text>
                  </div>
                )}

                <div className="space-y-2 rounded-md border border-ui-border-base p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Text size="small" weight="plus">
                      QuickBooks source item
                    </Text>
                    {qbdItemFact?.is_active !== null && qbdItemFact?.is_active !== undefined && (
                      <Badge color={qbdItemFact.is_active ? "green" : "orange"}>
                        {qbdItemFact.is_active ? "Active" : "Inactive"}
                      </Badge>
                    )}
                  </div>
                  {qbdItemFact ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Text className="text-ui-fg-subtle" size="small">
                          Type
                        </Text>
                        <Text className="break-words">{qbdItemFact.type}</Text>
                      </div>
                      <div>
                        <Text className="text-ui-fg-subtle" size="small">
                          List ID
                        </Text>
                        <Text className="break-words">{qbdItemFact.id}</Text>
                      </div>
                      <div>
                        <Text className="text-ui-fg-subtle" size="small">
                          Name
                        </Text>
                        <Text className="break-words">{qbdItemFact.name || "None"}</Text>
                      </div>
                      <div>
                        <Text className="text-ui-fg-subtle" size="small">
                          Full name
                        </Text>
                        <Text className="break-words">{qbdItemFact.full_name || "None"}</Text>
                      </div>
                      <div className="col-span-2">
                        <Text className="text-ui-fg-subtle" size="small">
                          Sales description
                        </Text>
                        <Text className="break-words">
                          {qbdItemFact.sales_description || "None"}
                        </Text>
                      </div>
                      <div>
                        <Text className="text-ui-fg-subtle" size="small">
                          Sales price
                        </Text>
                        <Text>{qbdItemFact.sales_price || "None"}</Text>
                      </div>
                    </div>
                  ) : (
                    <Text className="text-ui-fg-subtle" size="small">
                      {isLoadingSuggestions
                        ? "Loading QuickBooks item..."
                        : qbdItemLookup?.available === false
                          ? `Unavailable: ${qbdItemLookup.reason || "unknown"}`
                          : "No live QuickBooks item found for this List ID."}
                    </Text>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <Text size="small" weight="plus">
                      Suggested catalog matches
                    </Text>
                    {isLoadingSuggestions && (
                      <Text className="text-ui-fg-subtle" size="small">
                        Scoring...
                      </Text>
                    )}
                  </div>
                  <div className="max-h-64 overflow-auto rounded-md border border-ui-border-base">
                    {variantSuggestions.length > 0 ? (
                      variantSuggestions.map((variant) => (
                        <button
                          className="flex w-full flex-col gap-1 border-b border-ui-border-base px-3 py-2 text-left last:border-b-0 hover:bg-ui-bg-subtle"
                          key={variant.variant_id}
                          onClick={() => selectVariant(variant)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <Text weight="plus">
                              {variant.product_title || "Untitled product"}
                            </Text>
                            <Badge
                              color={
                                variant.review_status === "high_confidence"
                                  ? "green"
                                  : "orange"
                              }
                            >
                              {Math.round(variant.score * 100)}%
                            </Badge>
                          </div>
                          <Text className="text-ui-fg-subtle" size="small">
                            {[variant.variant_title, variant.sku, variant.variant_id]
                              .filter(Boolean)
                              .join(" / ")}
                          </Text>
                          <Text className="text-ui-fg-subtle" size="small">
                            {variant.reasons.join(", ")}
                          </Text>
                          {variant.identity_warnings.length > 0 && (
                            <Text className="text-ui-fg-error" size="small">
                              Check identity: {variant.identity_warnings.join(", ")}
                            </Text>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3">
                        <Text className="text-ui-fg-subtle" size="small">
                          No safe scored suggestions. Search manually below.
                        </Text>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Text className="text-ui-fg-subtle" size="small">
                    Find current catalog variant
                  </Text>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input
                      value={variantQuery}
                      onChange={(event) => setVariantQuery(event.target.value)}
                      placeholder="Search product title, variant title, SKU, or variant ID"
                    />
                    <Button
                      disabled={isSearchingVariants}
                      isLoading={isSearchingVariants}
                      onClick={() => void searchVariants()}
                      type="button"
                      variant="secondary"
                    >
                      Find
                    </Button>
                  </div>
                  {variantResults.length > 0 && (
                    <div className="max-h-56 overflow-auto rounded-md border border-ui-border-base">
                      {variantResults.map((variant) => (
                        <button
                          className="flex w-full flex-col border-b border-ui-border-base px-3 py-2 text-left last:border-b-0 hover:bg-ui-bg-subtle"
                          key={variant.variant_id}
                          onClick={() => selectVariant(variant)}
                          type="button"
                        >
                          <Text weight="plus">
                            {variant.product_title || "Untitled product"}
                          </Text>
                          <Text className="text-ui-fg-subtle" size="small">
                            {[variant.variant_title, variant.sku, variant.variant_id]
                              .filter(Boolean)
                              .join(" / ")}
                          </Text>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <Text className="mb-1 text-ui-fg-subtle" size="small">
                    Medusa SKU
                  </Text>
                  <Input
                    value={targetSku}
                    onChange={(event) => setTargetSku(event.target.value)}
                    placeholder="Current catalog SKU"
                  />
                </div>

                <div>
                  <Text className="mb-1 text-ui-fg-subtle" size="small">
                    Medusa variant ID
                  </Text>
                  <Input
                    value={targetVariantId}
                    onChange={(event) => setTargetVariantId(event.target.value)}
                    placeholder="Optional if SKU is entered"
                  />
                </div>

                <div>
                  <Text className="mb-1 text-ui-fg-subtle" size="small">
                    Description contains
                  </Text>
                  <Input
                    value={descriptionContains}
                    onChange={(event) => setDescriptionContains(event.target.value)}
                    placeholder="Required for generic QuickBooks buckets"
                  />
                </div>

                <div>
                  <Text className="mb-1 text-ui-fg-subtle" size="small">
                    Staff note
                  </Text>
                  <Textarea
                    value={staffNote}
                    onChange={(event) => setStaffNote(event.target.value)}
                    placeholder="Why this is the same sellable item"
                  />
                </div>

                {preview && previewKey === currentPreviewKey() && (
                  <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                    <Text size="small" weight="plus">
                      Mapping preview
                    </Text>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      Target: {preview.result.variant.product_title || "Untitled product"}
                      {preview.result.variant.variant_title
                        ? ` / ${preview.result.variant.variant_title}`
                        : ""}
                      {preview.result.variant.sku ? ` / ${preview.result.variant.sku}` : ""}
                    </Text>
                    <Text className="mt-1 text-ui-fg-subtle" size="small">
                      This will backfill {preview.result.lineRowsBackfilled} historical line
                      {preview.result.lineRowsBackfilled === 1 ? "" : "s"} and create{" "}
                      {preview.result.matchRuleUpserted
                        ? "a scoped description match rule"
                        : "a direct QuickBooks item map"}.
                    </Text>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={isSubmitting}
                    onClick={() => void previewMapping()}
                    type="button"
                    variant="secondary"
                  >
                    Preview mapping
                  </Button>
                  <Button
                    disabled={
                      isSubmitting ||
                      !preview ||
                      previewKey !== currentPreviewKey()
                    }
                    isLoading={isSubmitting}
                    type="submit"
                  >
                    Approve mapping
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <Text className="text-ui-fg-subtle">
                Select an unmapped legacy item group to inspect and approve a mapping.
              </Text>
            </div>
          )}
        </aside>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Legacy Item Mapping",
  icon: DocumentText,
})

export default LegacyItemMappingPage
