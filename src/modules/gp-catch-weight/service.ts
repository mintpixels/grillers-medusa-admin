import { MedusaService } from "@medusajs/framework/utils"
import FinalChargeAttempt from "./models/final-charge-attempt"
import OrderFinalization from "./models/order-finalization"
import OrderFinalizationLine from "./models/order-finalization-line"
import OrderPaymentSetup from "./models/order-payment-setup"

class GpCatchWeightModuleService extends MedusaService({
  FinalChargeAttempt,
  OrderFinalization,
  OrderFinalizationLine,
  OrderPaymentSetup,
}) {}

export default GpCatchWeightModuleService
