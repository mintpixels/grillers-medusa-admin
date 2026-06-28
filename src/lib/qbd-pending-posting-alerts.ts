import { emitOpsAlert } from "./ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

type QbdPendingPostingOrder = {
  id?: string | null
  display_id?: string | number | null
  metadata?: unknown
}

type StaleQbdPostingAlertInput = {
  orders: QbdPendingPostingOrder[]
  logger?: LoggerLike
  path?: string
  now?: Date
  staleAfterMinutes?: number
}

type StaleQbdPostingOrder = {
  order_id: string | null
  display_id: string | null
  qbd_posting_status: string
  qbd_posting_action: string | null
  qbd_posting_request_key: string | null
  qbd_posting_requested_at: string
  age_minutes: number
}

const DEFAULT_STALE_AFTER_MINUTES = 120
const MAX_SAMPLE_ORDERS = 10
const DEFAULT_PATH = "src/api/admin/grillers/finalization/queue/route.ts"

function metadataObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function booleanValue(value: unknown): boolean {
  return value === true || textValue(value).toLowerCase() === "true"
}

function staleAfterMinutes(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STALE_AFTER_MINUTES
  }
  return Math.min(Math.max(Math.round(parsed), 15), 24 * 60)
}

function configuredStaleAfterMinutes() {
  return staleAfterMinutes(process.env.QBD_PENDING_POSTING_STALE_MINUTES)
}

function ageMinutes(requestedAt: string, now: Date): number | null {
  const requested = new Date(requestedAt)
  const age = now.getTime() - requested.getTime()
  if (Number.isNaN(requested.getTime()) || !Number.isFinite(age) || age < 0) {
    return null
  }
  return Math.floor(age / 60_000)
}

function pendingPostingOrder(
  order: QbdPendingPostingOrder,
  now: Date,
  thresholdMinutes: number
): StaleQbdPostingOrder | null {
  const metadata = metadataObject(order.metadata)
  if (!booleanValue(metadata.qbd_posting_required)) {
    return null
  }

  const status = textValue(metadata.qbd_posting_status)
  if (!status.toLowerCase().startsWith("pending")) {
    return null
  }

  const requestedAt = textValue(metadata.qbd_posting_requested_at)
  if (!requestedAt) {
    return null
  }

  const age = ageMinutes(requestedAt, now)
  if (age === null || age < thresholdMinutes) {
    return null
  }

  return {
    order_id: textValue(order.id) || null,
    display_id: textValue(order.display_id) || null,
    qbd_posting_status: status,
    qbd_posting_action: textValue(metadata.qbd_posting_action) || null,
    qbd_posting_request_key:
      textValue(metadata.qbd_posting_request_key) || null,
    qbd_posting_requested_at: requestedAt,
    age_minutes: age,
  }
}

export function buildStaleQbdPostingAlert({
  orders,
  now = new Date(),
  staleAfterMinutes,
}: Pick<
  StaleQbdPostingAlertInput,
  "orders" | "now" | "staleAfterMinutes"
>) {
  const thresholdMinutes =
    staleAfterMinutes === undefined
      ? configuredStaleAfterMinutes()
      : staleAfterMinutes
  const staleOrders = orders
    .map((order) => pendingPostingOrder(order, now, thresholdMinutes))
    .filter((order): order is StaleQbdPostingOrder => Boolean(order))
    .sort((a, b) => b.age_minutes - a.age_minutes)

  if (!staleOrders.length) {
    return null
  }

  return {
    alertKind: "qbd_pending_posting_stale",
    title: `QBD posting pending for ${staleOrders.length} order(s) beyond ${thresholdMinutes}m`,
    severity: "warn" as const,
    fingerprint: "qbd:pending_posting_stale",
    meta: {
      stale_after_minutes: thresholdMinutes,
      stale_order_count: staleOrders.length,
      oldest_age_minutes: staleOrders[0].age_minutes,
      stale_orders: staleOrders.slice(0, MAX_SAMPLE_ORDERS),
    },
  }
}

export async function emitStaleQbdPostingAlertForOrders({
  orders,
  logger,
  path = DEFAULT_PATH,
  now,
  staleAfterMinutes,
}: StaleQbdPostingAlertInput) {
  const alert = buildStaleQbdPostingAlert({
    orders,
    now,
    staleAfterMinutes,
  })

  if (!alert) {
    return { emitted: false }
  }

  await emitOpsAlert({
    alertKind: alert.alertKind,
    title: alert.title,
    severity: alert.severity,
    path,
    source: "medusa-server",
    fingerprint: alert.fingerprint,
    logger,
    meta: alert.meta,
  })

  return {
    emitted: true,
    staleOrderCount: alert.meta.stale_order_count,
  }
}
