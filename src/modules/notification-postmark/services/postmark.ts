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
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    const from = notification.from?.trim() || this.config_.from

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
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Postmark send failed (${res.status}): ${errBody}`
      )
    }

    const body = (await res.json()) as { MessageID?: string }
    return { id: body.MessageID }
  }
}
