import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { timingSafeEqual } from "node:crypto"

type MetadataBody = {
  metadata?: Record<string, unknown>
}

const header = (req: MedusaRequest, name: string): string => {
  const headers = req.headers as any
  return headers[name.toLowerCase()] || headers.get?.(name) || ""
}

const metadataObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {}
    } catch {
      return {}
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

const secureCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  )
}

const authorized = (req: MedusaRequest): boolean => {
  const token = process.env.QB_SYNC_ORDER_IMPORT_TOKEN || ""
  if (!token) return false

  const provided =
    header(req, "x-qb-sync-token") ||
    header(req, "authorization").replace(/^Bearer\s+/i, "")

  return provided ? secureCompare(provided, token) : false
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  const orderId = req.params.id
  const body = (req.body ?? {}) as MetadataBody
  const incomingMetadata = metadataObject(body.metadata)

  if (!orderId || Object.keys(incomingMetadata).length === 0) {
    res.status(422).json({ error: "Missing order id or metadata" })
    return
  }

  const orderModule = req.scope.resolve(Modules.ORDER)
  const order = await orderModule.retrieveOrder(orderId, {
    select: ["id", "metadata"],
  })

  const metadata = {
    ...metadataObject(order?.metadata),
    ...incomingMetadata,
  }

  await orderModule.updateOrders(orderId, { metadata })

  res.status(200).json({ ok: true, order_id: orderId })
}
