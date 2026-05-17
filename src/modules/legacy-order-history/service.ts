import { MedusaService } from "@medusajs/framework/utils"
import LegacyCustomerMap from "./models/customer-map"
import LegacyItemMap from "./models/item-map"
import LegacyItemMatchRule from "./models/item-match-rule"
import LegacyOrder from "./models/order"
import LegacyOrderLine from "./models/order-line"

class LegacyOrderHistoryModuleService extends MedusaService({
  LegacyCustomerMap,
  LegacyItemMap,
  LegacyItemMatchRule,
  LegacyOrder,
  LegacyOrderLine,
}) {}

export default LegacyOrderHistoryModuleService
