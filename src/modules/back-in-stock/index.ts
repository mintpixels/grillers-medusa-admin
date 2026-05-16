import { Module } from "@medusajs/framework/utils"
import BackInStockModuleService from "./service"

export const BACK_IN_STOCK_MODULE = "back_in_stock"

export default Module(BACK_IN_STOCK_MODULE, {
  service: BackInStockModuleService,
})
