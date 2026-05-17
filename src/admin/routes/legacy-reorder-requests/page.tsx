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

type ReorderRequest = {
  id: string
  medusa_customer_id: string
  email_lower: string | null
  customer_name: string | null
  legacy_history_key: string
  legacy_item_id: string | null
  sku: string | null
  title: string
  product_title: string | null
  last_ordered_at: string | null
  last_order_ref: string | null
  times_ordered: number
  order_count: number
  total_quantity: number
  unit_price: number
  currency_code: string
  request_status: string
  notification_status: string | null
  notification_error: string | null
  requested_at: string | null
  metadata?: {
    staff_note?: string | null
    mapping_result?: {
      medusa_variant_id?: string | null
      medusa_sku?: string | null
      line_rows_backfilled?: number
      item_map_upserted?: boolean
      match_rule_upserted?: boolean
    }
  } | null
}

type ReorderRequestListResponse = {
  requests: ReorderRequest[]
  count: number
  limit: number
  offset: number
}

type MappingResult = {
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

const statusOptions = [
  { value: "submitted", label: "Submitted" },
  { value: "contacted", label: "Contacted" },
  { value: "mapped", label: "Mapped" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "notification_failed", label: "Email failed" },
]

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

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(value || 0)
}

function badgeColor(status: string) {
  if (status === "mapped" || status === "resolved") return "green" as const
  if (status === "dismissed") return "grey" as const
  if (status === "notification_failed") return "red" as const
  if (status === "contacted") return "blue" as const
  return "orange" as const
}

function statusLabel(status: string) {
  return statusOptions.find((option) => option.value === status)?.label || status
}

function isGenericRequest(request: ReorderRequest | null) {
  return request?.legacy_history_key.startsWith("legacy-description:") ?? false
}

function historySearchTerm(request: ReorderRequest) {
  return (
    request.last_order_ref ||
    request.sku ||
    request.legacy_item_id ||
    request.title ||
    request.id
  )
}

const LegacyReorderRequestsPage = () => {
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("submitted")
  const [requests, setRequests] = useState<ReorderRequest[]>([])
  const [count, setCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [targetSku, setTargetSku] = useState("")
  const [targetVariantId, setTargetVariantId] = useState("")
  const [descriptionContains, setDescriptionContains] = useState("")
  const [staffNote, setStaffNote] = useState("")

  const selected = useMemo(
    () => requests.find((request) => request.id === selectedId) ?? null,
    [requests, selectedId]
  )

  async function fetchRequests(search = query, requestStatus = status) {
    setIsLoading(true)
    setError(null)

    const params = new URLSearchParams({
      limit: "50",
      offset: "0",
      status: requestStatus,
    })
    if (search.trim()) {
      params.set("q", search.trim())
    }

    try {
      const response = await fetch(`/admin/legacy-reorder-requests?${params}`, {
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }

      const data = (await response.json()) as ReorderRequestListResponse
      setRequests(data.requests ?? [])
      setCount(data.count ?? 0)
      setSelectedId((current) => {
        if (current && data.requests?.some((request) => request.id === current)) {
          return current
        }

        return data.requests?.[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchRequests("", "submitted")
  }, [])

  useEffect(() => {
    if (!selected) {
      setTargetSku("")
      setTargetVariantId("")
      setDescriptionContains("")
      setStaffNote("")
      return
    }

    setTargetSku(selected.metadata?.mapping_result?.medusa_sku || "")
    setTargetVariantId(selected.metadata?.mapping_result?.medusa_variant_id || "")
    setDescriptionContains(isGenericRequest(selected) ? selected.title : "")
    setStaffNote(selected.metadata?.staff_note || "")
    setResult(null)
  }, [selectedId, selected])

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void fetchRequests()
  }

  async function markStatus(requestStatus: string) {
    if (!selected) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(`/admin/legacy-reorder-requests/${selected.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          request_status: requestStatus,
          staff_note: staffNote,
        }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.message || `Request failed with ${response.status}`)
      }

      setResult(`Marked ${statusLabel(requestStatus).toLowerCase()}.`)
      await fetchRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function approveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return

    setIsSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(
        `/admin/legacy-reorder-requests/${selected.id}/map`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            medusa_sku: targetSku,
            medusa_variant_id: targetVariantId,
            description_contains: descriptionContains,
            staff_note: staffNote,
          }),
        }
      )
      const body = (await response.json().catch(() => ({}))) as Partial<MappingResult> & {
        message?: string
      }
      if (!response.ok) {
        throw new Error(body.message || `Request failed with ${response.status}`)
      }

      const rows = body.result?.lineRowsBackfilled ?? 0
      setResult(`Mapped ${rows} historical line${rows === 1 ? "" : "s"}.`)
      await fetchRequests()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedTitle = selected?.product_title || selected?.title || "Past purchase"

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        <div>
          <Heading>Legacy Reorder Requests</Heading>
          <Text className="text-ui-fg-subtle" size="small">
            Resolve customer staff-assisted reorder requests and create durable QuickBooks-to-Medusa mappings.
          </Text>
        </div>
        <Badge color="grey">{count} requests</Badge>
      </div>

      <form className="grid grid-cols-[minmax(0,1fr)_180px_auto] gap-2 px-6 py-4" onSubmit={onSearch}>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Customer, item, SKU, invoice..."
        />
        <select
          className="rounded-md border border-ui-border-base bg-ui-bg-base px-3 text-ui-fg-base"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            void fetchRequests(query, event.target.value)
          }}
        >
          <option value="all">All statuses</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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

      <div className="grid min-h-[640px] grid-cols-[minmax(0,1fr)_440px]">
        <div className="border-r">
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>Item</Table.HeaderCell>
                <Table.HeaderCell>Customer</Table.HeaderCell>
                <Table.HeaderCell>Requested</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {requests.map((request) => (
                <Table.Row
                  className="cursor-pointer"
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                >
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text weight="plus">
                        {request.product_title || request.title}
                      </Text>
                      <Text className="text-ui-fg-subtle" size="small">
                        {request.sku ? `SKU ${request.sku}` : request.legacy_item_id || request.id}
                      </Text>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex flex-col">
                      <Text>{request.customer_name || "Unknown customer"}</Text>
                      {request.email_lower && (
                        <Text className="text-ui-fg-subtle" size="small">
                          {request.email_lower}
                        </Text>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{formatDate(request.requested_at)}</Table.Cell>
                  <Table.Cell>
                    <Badge color={badgeColor(request.request_status)}>
                      {statusLabel(request.request_status)}
                    </Badge>
                  </Table.Cell>
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
                      Customer request
                    </Text>
                    <Heading level="h2">{selectedTitle}</Heading>
                  </div>
                  <Badge color={badgeColor(selected.request_status)}>
                    {statusLabel(selected.request_status)}
                  </Badge>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Customer
                    </Text>
                    <Text>{selected.customer_name || "Unknown"}</Text>
                    {selected.email_lower && (
                      <Text className="text-ui-fg-subtle" size="small">
                        {selected.email_lower}
                      </Text>
                    )}
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Last ordered
                    </Text>
                    <Text>{formatDate(selected.last_ordered_at)}</Text>
                    {selected.last_order_ref && (
                      <Text className="text-ui-fg-subtle" size="small">
                        Invoice {selected.last_order_ref}
                      </Text>
                    )}
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Orders
                    </Text>
                    <Text>{selected.order_count || selected.times_ordered}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Quantity
                    </Text>
                    <Text>{selected.total_quantity}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Last price
                    </Text>
                    <Text>{formatMoney(selected.unit_price, selected.currency_code)}</Text>
                  </div>
                  <div>
                    <Text className="text-ui-fg-subtle" size="small">
                      Legacy item
                    </Text>
                    <Text>{selected.legacy_item_id || selected.sku || "Description rule"}</Text>
                  </div>
                </div>

                <a
                  className="mt-4 inline-flex text-ui-fg-interactive"
                  href={`/app/legacy-orders?q=${encodeURIComponent(historySearchTerm(selected))}`}
                >
                  Open matching historical orders
                </a>
              </div>

              <form className="space-y-4 px-6 py-4" onSubmit={approveMapping}>
                {isGenericRequest(selected) && (
                  <div className="rounded-md border border-ui-border-base bg-ui-bg-subtle p-3">
                    <Text size="small" weight="plus">
                      Description matcher required
                    </Text>
                    <Text className="text-ui-fg-subtle" size="small">
                      This came from a generic QuickBooks item bucket. Do not map the whole bucket unless every line is the same product.
                    </Text>
                  </div>
                )}

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
                    placeholder="Use for Misc. Item or other generic buckets"
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

                <div className="flex flex-wrap gap-2">
                  <Button isLoading={isSubmitting} type="submit">
                    Approve mapping
                  </Button>
                  <Button
                    disabled={isSubmitting}
                    onClick={() => void markStatus("contacted")}
                    type="button"
                    variant="secondary"
                  >
                    Mark contacted
                  </Button>
                  <Button
                    disabled={isSubmitting}
                    onClick={() => void markStatus("resolved")}
                    type="button"
                    variant="secondary"
                  >
                    Resolve
                  </Button>
                  <Button
                    disabled={isSubmitting}
                    onClick={() => void markStatus("dismissed")}
                    type="button"
                    variant="danger"
                  >
                    Dismiss
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex h-full items-center justify-center px-8 text-center">
              <Text className="text-ui-fg-subtle">
                Select a request to inspect the historical item and approve a mapping.
              </Text>
            </div>
          )}
        </aside>
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Legacy Reorder Requests",
  icon: DocumentText,
})

export default LegacyReorderRequestsPage
