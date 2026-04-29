import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PostmarkNotificationService } from "./services/postmark"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [PostmarkNotificationService],
})
