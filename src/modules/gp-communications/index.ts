import { Module } from "@medusajs/framework/utils"
import GpCommunicationsModuleService from "./service"

export const GP_COMMUNICATIONS_MODULE = "gp_communications"

export default Module(GP_COMMUNICATIONS_MODULE, {
  service: GpCommunicationsModuleService,
})
