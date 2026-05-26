import { MedusaService } from "@medusajs/framework/utils"
import InventoryAllocation from "./models/inventory-allocation"
import InventoryAllocationAudit from "./models/inventory-allocation-audit"
import InventoryAvailabilitySnapshot from "./models/inventory-availability-snapshot"

class GpInventoryAllocationModuleService extends MedusaService({
  InventoryAllocation,
  InventoryAllocationAudit,
  InventoryAvailabilitySnapshot,
}) {}

export default GpInventoryAllocationModuleService
