import { AbstractAnalyticsProviderService } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/framework/types"
import type {
  ProviderTrackAnalyticsEventDTO,
  ProviderIdentifyAnalyticsEventDTO,
} from "@medusajs/types"

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
        event_id: crypto.randomUUID(),
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

    const sessionId =
      properties?.session_id ||
      properties?.cart_id ||
      properties?.transaction_id ||
      crypto.randomUUID()
    const userId = actorId || properties?.customer_id

    if (!userId && !properties?.anonymous_id) {
      this.logger_.debug(
        `Analytics: Skipping GP dual-run ${eventType}; no user_id or anonymous_id`
      )
      return
    }

    const body = {
      event: eventType,
      event_id: crypto.randomUUID(),
      event_timestamp_ms: Date.now(),
      user_id: userId,
      anonymous_id: properties?.anonymous_id,
      session_id: String(sessionId),
      experience_version: "medusa",
      route_market: this.routeMarket(properties?.route_market),
      fulfillment_tier:
        properties?.fulfillment_tier || properties?.shipping_tier || null,
      customer_type: this.customerType(properties?.customer_type),
      source: properties?.source === "staff" ? "admin" : "medusa-server",
      properties: properties || {},
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
    }).catch((err) => {
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
    this.sendToJitsu(payload)
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
