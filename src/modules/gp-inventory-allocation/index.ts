import { Module } from "@medusajs/framework/utils"
import GpInventoryAllocationModuleService from "./service"

export const GP_INVENTORY_ALLOCATION_MODULE = "gp_inventory_allocation"

export default Module(GP_INVENTORY_ALLOCATION_MODULE, {
  service: GpInventoryAllocationModuleService,
})
