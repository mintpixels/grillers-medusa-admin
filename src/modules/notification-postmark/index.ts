import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import { PostmarkNotificationService } from "./services/postmark"

console.log("[PM-PROVIDER-LOAD] notification-postmark provider index loaded at boot")

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [PostmarkNotificationService],
})
