import GpAnalyticsProviderService from "./service"
import { ModuleProvider, Modules } from "@medusajs/framework/utils"

export default ModuleProvider(Modules.ANALYTICS, {
  services: [GpAnalyticsProviderService],
})
