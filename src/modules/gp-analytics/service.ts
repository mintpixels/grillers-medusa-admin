import { AbstractAnalyticsProviderService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  ProviderTrackAnalyticsEventDTO,
  ProviderIdentifyAnalyticsEventDTO,
} from "@medusajs/types"
import { createHash, randomUUID } from "crypto"

type InjectedDependencies = {
  logger: Logger
}

type Options = {
  jitsuHost: string
  jitsuServerSecret: string
  gpAnalyticsEndpoint?: string
  gpAnalyticsServerKey?: string
  gpAnalyticsDualRun?: boolean
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GP_ANALYTICS_UUID_NAMESPACE = "da4ce64b-035f-5f38-95cb-a0d24ecb5fd7"
const STAFF_SOURCES = new Set([
  "staff",
  "staff_phone_order",
  "staff_impersonation",
  "admin_staff_reorder",
])

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex")
}

function uuidV5(name: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(GP_ANALYTICS_UUID_NAMESPACE))
    .update(name)
    .digest()

  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80

  const hex = hash.subarray(0, 16).toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number" && Number.isFinite(value)) return String(value)
  }
  return ""
}

class GpAnalyticsProviderService extends AbstractAnalyticsProviderService {
  static identifier = "gp-analytics"

  protected logger_: Logger
  protected options_: Options

  constructor({ logger }: InjectedDependencies, options: Options) {
    super()
    this.logger_ = logger
    this.options_ = options
  }

  private buildPayload(
    eventType: string,
    actorId?: string,
    properties?: Record<string, any>
  ): Record<string, any> {
    return {
      event_type: eventType,
      eventn_ctx: {
        event_id: randomUUID(),
        event_timestamp_ms: Date.now(),
        source: "medusa-server",
        experience_version: "medusa",
        user_id: actorId,
        ...properties,
      },
    }
  }

  private sendToJitsu(payload: Record<string, any>): void {
    const { jitsuHost, jitsuServerSecret } = this.options_

    if (!jitsuHost || !jitsuServerSecret) {
      this.logger_.warn("Analytics: Jitsu not configured, skipping event")
      return
    }

    const url = `${jitsuHost}/api/v1/s2s/event`

    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": jitsuServerSecret,
      },
      body: JSON.stringify(payload),
    }).catch((err) => {
      this.logger_.error(
        `Analytics: Failed to send ${payload.event_type} to Jitsu: ${err.message}`
      )
    })
  }

  private routeMarket(value: any): string {
    if (
      value === "atlanta_metro" ||
      value === "southeast" ||
      value === "national"
    ) {
      return value
    }
    if (value === "core") return "atlanta_metro"
    if (value === "scheduled_pod") return "southeast"
    return "unknown"
  }

  private customerType(value: any): string {
    return value === "dtc" || value === "institutional" ? value : "unknown"
  }

  private isStaffSource(value: any): boolean {
    return STAFF_SOURCES.has(String(value || "").trim())
  }

  private fulfillmentTier(value: any): string | null {
    const text = firstText(value).toLowerCase().replace(/[\s-]+/g, "_")
    if (!text) return null

    if (text === "plant_pickup") return "plant_pickup"
    if (text === "atlanta_delivery" || text === "local_delivery") {
      return "atlanta_delivery"
    }
    if (text === "southeast_pickup" || text === "regional_pickup") {
      return "southeast_pickup"
    }
    if (text === "ups_ground" || text === "ground") return "ups_ground"
    if (
      text === "ups_3day" ||
      text === "ups_3_day_select" ||
      text === "3_day_select" ||
      text.includes("3_day")
    ) {
      return "ups_3day"
    }
    if (
      text === "ups_2da" ||
      text === "ups_2day" ||
      text === "ups_2_day" ||
      text === "ups_2nd_day_air" ||
      text === "2nd_day_air" ||
      text === "2_day_air" ||
      text.includes("2nd_day") ||
      text.includes("second_day")
    ) {
      return "ups_2da"
    }
    if (
      text === "ups_overnight" ||
      text === "overnight" ||
      text.includes("next_day")
    ) {
      return "ups_overnight"
    }
    if (text.includes("southeast") && text.includes("pickup")) {
      return "southeast_pickup"
    }
    if (text.includes("atlanta") && text.includes("delivery")) {
      return "atlanta_delivery"
    }
    if (text.includes("pickup")) return "plant_pickup"
    if (text.includes("ground")) return "ups_ground"
    if (text.includes("3_day")) return "ups_3day"
    if (text.includes("2nd_day") || text.includes("second_day")) {
      return "ups_2da"
    }
    if (text.includes("overnight")) return "ups_overnight"

    return null
  }

  private idempotencyKey(
    eventType: string,
    properties?: Record<string, any>
  ): string | null {
    const explicit = firstText(
      properties?.idempotency_key,
      properties?.medusa_event_id
    )
    if (explicit) return explicit

    if (!eventType.startsWith("order_")) return null

    const orderId = firstText(properties?.order_id, properties?.transaction_id)
    if (orderId) return `${eventType}:${orderId}`

    return null
  }

  private sessionId(properties?: Record<string, any>): string {
    const candidate = firstText(properties?.session_id)
    if (candidate && UUID_RE.test(candidate)) return candidate

    const deterministicSeed = firstText(
      properties?.cart_id,
      properties?.order_id,
      properties?.transaction_id
    )
    if (deterministicSeed) return uuidV5(`session:${deterministicSeed}`)

    return randomUUID()
  }

  private sendToGpAnalytics(
    eventType: string,
    actorId?: string,
    properties?: Record<string, any>
  ): void {
    const {
      gpAnalyticsEndpoint,
      gpAnalyticsServerKey,
      gpAnalyticsDualRun = true,
    } = this.options_

    if (!gpAnalyticsEndpoint || !gpAnalyticsServerKey || !gpAnalyticsDualRun) {
      return
    }

    const mirrorProperties = { ...(properties || {}) }
    if (!mirrorProperties.order_id && mirrorProperties.transaction_id) {
      mirrorProperties.order_id = mirrorProperties.transaction_id
    }

    const sessionId = this.sessionId(mirrorProperties)
    const idempotencyKey = this.idempotencyKey(eventType, mirrorProperties)
    const fulfillmentTier = this.fulfillmentTier(
      mirrorProperties.fulfillment_tier || mirrorProperties.shipping_tier
    )
    const userId = actorId || mirrorProperties.customer_id

    if (!userId && !mirrorProperties.anonymous_id) {
      this.logger_.debug(
        `Analytics: Skipping GP dual-run ${eventType}; no user_id or anonymous_id`
      )
      return
    }

    mirrorProperties.session_id = sessionId
    if (fulfillmentTier) {
      mirrorProperties.fulfillment_tier = fulfillmentTier
    }

    const body = {
      event: eventType,
      event_id: idempotencyKey ? uuidV5(idempotencyKey) : randomUUID(),
      idempotency_key: idempotencyKey || undefined,
      event_timestamp_ms: Date.now(),
      user_id: userId,
      anonymous_id: mirrorProperties.anonymous_id,
      session_id: String(sessionId),
      experience_version: "medusa",
      route_market: this.routeMarket(mirrorProperties.route_market),
      fulfillment_tier: fulfillmentTier,
      customer_type: this.customerType(mirrorProperties.customer_type),
      source: this.isStaffSource(mirrorProperties.source)
        ? "admin"
        : "medusa-server",
      properties: mirrorProperties,
      context: {
        library: {
          name: "grillers-medusa-admin-gp-analytics-dual-run",
          version: "0.1.0",
        },
      },
    }

    fetch(`${gpAnalyticsEndpoint.replace(/\/$/, "")}/v1/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gpAnalyticsServerKey}`,
      },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        if (res.ok) return
        const text =
          typeof res.text === "function" ? await res.text().catch(() => "") : ""
        const firstLine = text.split(/\r?\n/)[0] || ""
        this.logger_.warn(
          `Analytics: GP analytics rejected ${eventType} with ${res.status}: ${firstLine}`
        )
      })
      .catch((err) => {
        this.logger_.error(
          `Analytics: Failed to send ${eventType} to GP analytics: ${err.message}`
        )
      })
  }

  async track(data: ProviderTrackAnalyticsEventDTO): Promise<void> {
    const payload = this.buildPayload(
      data.event,
      data.actor_id,
      data.properties
    )

    this.logger_.debug(`Analytics: Tracking ${data.event}`)
    if (data.event !== "order_finalized") {
      this.sendToJitsu(payload)
    }
    this.sendToGpAnalytics(data.event, data.actor_id, data.properties)
  }

  async identify(data: ProviderIdentifyAnalyticsEventDTO): Promise<void> {
    const actorId = "actor_id" in data ? data.actor_id : undefined
    const payload = this.buildPayload("identify", actorId, data.properties)

    this.logger_.debug(`Analytics: Identifying ${actorId}`)
    this.sendToJitsu(payload)
  }
}

export default GpAnalyticsProviderService
