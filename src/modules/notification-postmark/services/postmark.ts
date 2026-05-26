import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"

console.log("[PM-LOAD] postmark notification service module loaded at boot")

type PostmarkOptions = {
  api_token: string
  from: string
  transactional_stream?: string
  lifecycle_stream?: string
  broadcast_stream?: string
}

export class PostmarkNotificationService extends AbstractNotificationProviderService {
  static identifier = "notification-postmark"

  private logger_: Logger
  private config_: PostmarkOptions

  constructor({ logger }: { logger: Logger }, options: PostmarkOptions) {
    super()
    this.config_ = {
      api_token: options.api_token,
      from: options.from,
      transactional_stream: options.transactional_stream,
      lifecycle_stream: options.lifecycle_stream,
      broadcast_stream: options.broadcast_stream,
    }
    this.logger_ = logger
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    this.logger_.info(
      `[notification-postmark] send() called to=${notification?.to} channel=${notification?.channel} hasContent=${!!notification?.content}`
    )

    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    const from = notification.from?.trim() || this.config_.from
    const data = ((notification as any).data || {}) as Record<string, any>
    const metadata = data.metadata || {}
    const templateAlias = data.template_alias || data.TemplateAlias
    const templateModel = data.template_model || data.TemplateModel || {}
    const messageStream =
      data.message_stream ||
      data.MessageStream ||
      this.config_.transactional_stream ||
      "outbound"
    const tag = data.tag || data.Tag

    this.logger_.info(
      `[notification-postmark] POST api.postmarkapp.com from=${from} to=${notification.to} stream=${messageStream} subject="${notification.content?.subject}"`
    )

    const endpoint = templateAlias
      ? "https://api.postmarkapp.com/email/withTemplate"
      : "https://api.postmarkapp.com/email"
    const payload = templateAlias
      ? {
          From: from,
          To: notification.to,
          TemplateAlias: templateAlias,
          TemplateModel: templateModel,
          MessageStream: messageStream,
          ...(tag ? { Tag: tag } : {}),
          ...(Object.keys(metadata).length ? { Metadata: metadata } : {}),
        }
      : {
          From: from,
          To: notification.to,
          Subject: notification.content?.subject,
          HtmlBody: notification.content?.html,
          TextBody: notification.content?.text,
          MessageStream: messageStream,
          ...(tag ? { Tag: tag } : {}),
          ...(Object.keys(metadata).length ? { Metadata: metadata } : {}),
        }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.config_.api_token,
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const errBody = await res.text()
      this.logger_.error(
        `[notification-postmark] Postmark rejected: status=${res.status} body=${errBody}`
      )
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Postmark send failed (${res.status}): ${errBody}`
      )
    }

    const body = (await res.json()) as { MessageID?: string }
    this.logger_.info(
      `[notification-postmark] Postmark accepted MessageID=${body.MessageID}`
    )
    return { id: body.MessageID }
  }
}
