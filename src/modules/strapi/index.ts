import { Module } from "@medusajs/framework/utils";
import StrapiModuleService from "./service";

export const STRAPI_MODULE = "strapi";

export default Module(STRAPI_MODULE, {
  service: StrapiModuleService,
});
