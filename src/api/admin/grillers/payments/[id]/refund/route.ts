import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { releaseAllocationLineQuantities } from "../../../../../../lib/inventory-allocation"
import { emitOpsAlert } from "../../../../../../lib/ops-alert"

type RefundBody = {
  amount?: number | string
  note?: string
  refund_reason_id?: string
  allocation_releases?: Array<{
    order_id?: string
    line_item_id?: string
    quantity?: number | string
  }>
}

const numericAmount = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Refund amount must be greater than zero.")
  }
  return amount
}

const refundAmount = (refund: Record<string, any>, fallback?: number): number => {
  const raw = refund.raw_amount
  const value =
    typeof raw === "object" && raw !== null && "value" in raw
      ? raw.value
      : raw ?? refund.amount ?? fallback ?? 0
  return Number(value)
}

const metadataObject = (value: unknown): Record<string, any> => {
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
    return { ...(value as Record<string, any>) }
  }
  return {}
}

const appendAuditLog = (
  metadata: Record<string, any>,
  entry: Record<string, any>
): Record<string, any> => {
  const raw = metadata.staff_audit_log
  let audit: Array<Record<string, any>> = []

  if (Array.isArray(raw)) {
    audit = raw
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      audit = Array.isArray(parsed) ? parsed : []
    } catch {
      audit = []
    }
  }

  return {
    ...metadata,
    staff_audit_log: JSON.stringify(
      [
        ...audit,
        {
          at: new Date().toISOString(),
          ...entry,
        },
      ].slice(-50)
    ),
  }
}

async function orderIdForPaymentCollection(
  query: { graph: (input: Record<string, unknown>) => Promise<{ data?: any[] }> },
  paymentCollectionId: string | undefined
): Promise<string | null> {
  if (!paymentCollectionId) return null

  const { data } = await query.graph({
    entity: "order_payment_collection",
    fields: ["order_id"],
    filters: { payment_collection_id: paymentCollectionId },
  })

  return data?.[0]?.order_id || null
}

async function queueQbdRefundPosting({
  orderModule,
  orderId,
  refund,
  refundAmountValue,
  note,
  actorId,
  logger,
}: {
  orderModule: any
  orderId: string
  refund: Record<string, any>
  refundAmountValue: number
  note?: string
  actorId?: string
  logger?: any
}) {
  const order = await orderModule.retrieveOrder(orderId, {
    select: ["id", "metadata"],
  })
  const amountMinor = Math.round(Math.abs(refundAmountValue) * 100)
  const requestKey = `refund:${refund.id}`
  const existingMetadata = metadataObject(order?.metadata)
  const existingPostingStatus = String(existingMetadata.qbd_posting_status || "")
  const existingRequestKey = existingMetadata.qbd_posting_request_key

  if (
    existingPostingStatus.startsWith("pending") &&
    existingRequestKey &&
    existingRequestKey !== requestKey
  ) {
    // #251: a refund must not silently overwrite an unconsumed QBD posting request.
    await emitOpsAlert({
      alertKind: "qbd_pending_posting_overwritten",
      title: `Refund ${refund.id} overwrote pending QBD posting for order ${orderId}`,
      path: "src/api/admin/grillers/payments/[id]/refund/route.ts",
      source: "medusa",
      logger,
      meta: {
        order_id: orderId,
        refund_id: refund.id,
        previous_qbd_posting_status: existingPostingStatus,
        previous_qbd_posting_request_key: existingRequestKey,
        next_qbd_posting_request_key: requestKey,
      },
    })
  }

  const metadata = appendAuditLog(
    {
      ...existingMetadata,
      qbd_posting_required: true,
      qbd_posting_status: "pending_manual",
      qbd_posting_action: "card_refund_accounting_record",
      qbd_posting_amount: amountMinor,
      qbd_posting_request_key: requestKey,
      qbd_posting_requested_at: new Date().toISOString(),
      stripe_refund_id: refund.id,
      stripe_provider_refund_id:
        refund.provider_refund_id || refund.data?.id || refund.id,
    },
    {
      action: "stripe_refund",
      status: "queued_for_quickbooks",
      qbd_posting_action: "card_refund_accounting_record",
      qbd_posting_request_key: requestKey,
      qbd_posting_amount: amountMinor,
      refund_id: refund.id,
      staff_actor_id: actorId,
      note: note || null,
    }
  )

  await orderModule.updateOrders(orderId, { metadata })
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const paymentId = req.params.id
  const body = (req.body ?? {}) as RefundBody
  const amount = numericAmount(body.amount)
  const paymentModule = req.scope.resolve(Modules.PAYMENT)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  const query = req.scope.resolve("query")
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  let logger: any
  try {
    logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  } catch {
    logger = undefined
  }

  const before = await paymentModule.retrievePayment(paymentId, {
    select: ["id", "payment_collection_id", "currency_code"],
    relations: ["refunds"],
  })
  const existingRefundIds = new Set(
    (before.refunds || []).map((refund: Record<string, any>) => refund.id)
  )

  const payment = await paymentModule.refundPayment({
    payment_id: paymentId,
    amount,
    note: body.note,
    refund_reason_id: body.refund_reason_id,
    created_by: (req as any).auth_context?.actor_id,
  })

  const refunds = (payment.refunds || []) as Array<Record<string, any>>
  const refund =
    refunds.find((candidate) => !existingRefundIds.has(candidate.id)) ||
    refunds[refunds.length - 1]

  const orderId = await orderIdForPaymentCollection(
    query,
    before.payment_collection_id || payment.payment_collection_id
  )

  if (orderId && refund?.id) {
    const resolvedRefundAmount = refundAmount(refund, amount)
    const existingTransactions = await orderModule.listOrderTransactions(
      {
        order_id: orderId,
        reference: "refund",
        reference_id: refund.id,
      },
      { select: ["id"] }
    )

    if (!existingTransactions.length) {
      await orderModule.addOrderTransactions({
        order_id: orderId,
        amount: -Math.abs(resolvedRefundAmount),
        currency_code: payment.currency_code || before.currency_code,
        reference: "refund",
        reference_id: refund.id,
      })
    }

    await queueQbdRefundPosting({
      orderModule,
      orderId,
      refund,
      refundAmountValue: resolvedRefundAmount,
      note: body.note,
      actorId: (req as any).auth_context?.actor_id,
      logger,
    })
  }

  if (refund?.id) {
    await eventBus.emit({
      name: "payment.refunded",
      data: {
        id: payment.id,
        payment_id: payment.id,
        refund_id: refund.id,
        order_id: orderId,
        amount: refundAmount(refund, amount),
        reason: body.note,
      },
    })
  }

  const allocationLines = (body.allocation_releases || [])
    .filter((line) => line.line_item_id)
    .map((line) => ({
      line_item_id: line.line_item_id!,
      quantity: numericAmount(line.quantity) || 0,
    }))
    .filter((line) => line.quantity > 0)
  const allocationOrderId =
    (body.allocation_releases || []).find((line) => line.order_id)?.order_id ||
    orderId

  if (allocationOrderId && allocationLines.length) {
    await releaseAllocationLineQuantities({
      db,
      orderId: allocationOrderId,
      lines: allocationLines,
      reason: "released_refund",
      actorType: "staff",
      actorId: (req as any).auth_context?.actor_id,
      note: body.note || null,
    })
  }

  res.status(200).json({ payment })
}
