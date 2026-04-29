import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"

type PostmarkOptions = {
  api_token: string
  from: string
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

    this.logger_.info(
      `[notification-postmark] POST api.postmarkapp.com from=${from} to=${notification.to} subject="${notification.content?.subject}"`
    )

    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.config_.api_token,
      },
      body: JSON.stringify({
        From: from,
        To: notification.to,
        Subject: notification.content?.subject,
        HtmlBody: notification.content?.html,
        TextBody: notification.content?.text,
        MessageStream: "outbound",
      }),
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
