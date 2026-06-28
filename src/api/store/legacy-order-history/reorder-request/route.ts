import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  LegacyReorderRequestError,
  notificationModuleFromScope,
  submitLegacyReorderRequest,
} from "../../../../lib/legacy-reorder-request"
import { emitOpsAlert } from "../../../../lib/ops-alert"

type ReorderRequestBody = {
  key?: string
}

const normalizeText = (value: unknown): string | null => {
  const text = String(value ?? "").trim()
  return text.length ? text : null
}

function sendResult(res: MedusaResponse, result: any) {
  const { httpStatus, ...body } = result
  res.status(httpStatus).json(body)
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const customerId = (req as any).auth_context?.actor_id
  if (!customerId) {
    res.status(401).json({ message: "Unauthorized" })
    return
  }

  const body = (req.body ?? {}) as ReorderRequestBody
  const key = normalizeText(body.key)
  if (!key) {
    res.status(400).json({ message: "Missing purchase history key" })
    return
  }

  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const result = await submitLegacyReorderRequest({
      db,
      notificationModule: notificationModuleFromScope(req.scope),
      logger,
      customerId,
      key,
      source: "storefront_reorder",
    })
    sendResult(res, result)
  } catch (err) {
    if (err instanceof LegacyReorderRequestError) {
      res.status(err.statusCode).json({ message: err.message })
      return
    }

    const message = err instanceof Error ? err.message : String(err)
    logger?.error?.(
      `[legacy-reorder-request] storefront submit failed customer=${customerId}: ${message}`
    )
    await emitOpsAlert({
      alertKind: "legacy_reorder_request_failed",
      severity: "page",
      path: "src/api/store/legacy-order-history/reorder-request/route.ts",
      title: "Storefront legacy reorder request failed",
      fingerprint: "legacy_reorder_request:storefront:500",
      meta: {
        customer_id: customerId,
        source: "storefront_reorder",
        has_key: Boolean(key),
        error_name: err instanceof Error ? err.name : undefined,
        error_message: message.slice(0, 300),
      },
      logger,
    })
    res.status(500).json({
      message: "Could not submit reorder request. Please try again or call the store.",
    })
  }
}
