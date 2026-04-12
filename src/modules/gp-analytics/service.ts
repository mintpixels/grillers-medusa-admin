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

  async track(data: ProviderTrackAnalyticsEventDTO): Promise<void> {
    const payload = this.buildPayload(
      data.event,
      data.actor_id,
      data.properties
    )

    this.logger_.debug(`Analytics: Tracking ${data.event}`)
    this.sendToJitsu(payload)
  }

  async identify(data: ProviderIdentifyAnalyticsEventDTO): Promise<void> {
    const actorId = "actor_id" in data ? data.actor_id : undefined
    const payload = this.buildPayload("identify", actorId, data.properties)

    this.logger_.debug(`Analytics: Identifying ${actorId}`)
    this.sendToJitsu(payload)
  }
}

export default GpAnalyticsProviderService
