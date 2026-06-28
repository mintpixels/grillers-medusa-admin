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

export function emitProductStrapiDeleteSkippedAlert(input: {
  medusaProductId: string
  strapiDocumentId?: string | null
  reason: "missing_strapi_entry" | "destructive_sync_disabled"
  logger?: LoggerLike
}) {
  const title =
    input.reason === "missing_strapi_entry"
      ? "Medusa product delete skipped because Strapi entry was missing"
      : "Medusa product delete skipped by Strapi destructive-sync guard"

  return emitOpsAlert({
    alertKind: "strapi_product_delete_skipped",
    severity: "warn",
    title,
    path: "src/subscribers/product-deleted.ts",
    source: "medusa-server",
    fingerprint: `strapi_product_delete_skipped:${input.reason}`,
    logger: input.logger,
    meta: {
      medusa_product_id: input.medusaProductId,
      strapi_document_id: input.strapiDocumentId || null,
      product_event: "product.deleted",
      sync_target: "strapi",
      skip_reason: input.reason,
      destructive_sync_enabled: false,
      backup_required_before_destructive_sync: true,
    },
  })
}
