import { emitOpsAlert } from "./ops-alert"

type LoggerLike = Parameters<typeof emitOpsAlert>[0]["logger"]

export type ProductStrapiSyncAction = "created" | "updated" | "deleted"

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object") {
    const record = error as Record<string, any>
    return (
      String(record.response?.data?.error?.message || "").trim() ||
      String(record.response?.data?.message || "").trim() ||
      String(record.message || "").trim() ||
      String(error)
    )
  }
  return String(error || "Unknown error")
}

export function emitProductStrapiSyncFailureAlert(input: {
  action: ProductStrapiSyncAction
  medusaProductId: string
  error: unknown
  logger?: LoggerLike
}) {
  const message = errorMessage(input.error)

  return emitOpsAlert({
    alertKind: "strapi_product_sync_failed",
    severity: "warn",
    title: `Medusa product ${input.action} sync to Strapi failed`,
    path: `src/subscribers/product-${input.action}.ts`,
    source: "medusa-server",
    logger: input.logger,
    meta: {
      medusa_product_id: input.medusaProductId,
      product_event: `product.${input.action}`,
      sync_target: "strapi",
      error_message: message.slice(0, 500),
    },
  })
}
