import { Module } from "@medusajs/framework/utils"
import GpCatchWeightModuleService from "./service"

export const GP_CATCH_WEIGHT_MODULE = "gp_catch_weight"

export default Module(GP_CATCH_WEIGHT_MODULE, {
  service: GpCatchWeightModuleService,
})
