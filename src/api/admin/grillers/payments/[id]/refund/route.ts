import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

type RefundBody = {
  amount?: number | string
  note?: string
  refund_reason_id?: string
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

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const paymentId = req.params.id
  const body = (req.body ?? {}) as RefundBody
  const amount = numericAmount(body.amount)
  const paymentModule = req.scope.resolve(Modules.PAYMENT)
  const orderModule = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  const query = req.scope.resolve("query")

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
        amount: -Math.abs(refundAmount(refund, amount)),
        currency_code: payment.currency_code || before.currency_code,
        reference: "refund",
        reference_id: refund.id,
      })
    }
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

  res.status(200).json({ payment })
}
