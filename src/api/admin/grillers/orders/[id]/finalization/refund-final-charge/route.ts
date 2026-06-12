import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  amountInMinorUnits,
  metadataObject,
} from "../../../../../../../lib/catch-weight-finalization"
import { releaseAllocationLineQuantities } from "../../../../../../../lib/inventory-allocation"

type RefundBody = {
  amount?: number | string
  note?: string
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

async function createStripeRefund({
  paymentIntentId,
  amount,
  currencyCode,
  orderId,
  note,
  idempotencyKey,
}: {
  paymentIntentId: string
  amount: number
  currencyCode: string
  orderId: string
  note?: string
  idempotencyKey?: string
}) {
  const apiKey = process.env.STRIPE_API_KEY
  if (!apiKey) {
    throw new Error("Stripe secret key is not configured.")
  }

  const body = new URLSearchParams({
    payment_intent: paymentIntentId,
    amount: String(amountInMinorUnits(amount, currencyCode)),
    "metadata[payment_workflow]": "setup_then_final_charge",
    "metadata[order_id]": orderId,
  })
  if (note) {
    body.set("metadata[note]", note)
  }

  const response = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body,
  })
  const json = await response.json()
  if (!response.ok) {
    throw new Error(json?.error?.message || "Stripe final-charge refund failed.")
  }

  return json as Record<string, any>
}

function requestHeader(req: MedusaRequest, name: string): string | undefined {
  const headers = (req as any).headers || {}
  return (
    headers[name] ||
    headers[name.toLowerCase()] ||
    (typeof (req as any).get === "function" ? (req as any).get(name) : undefined)
  )
}

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const orderId = req.params.id
  const body = (req.body ?? {}) as RefundBody
  const orderModule = req.scope.resolve(Modules.ORDER)
  const eventBus = req.scope.resolve(Modules.EVENT_BUS)
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  try {
    const order = await orderModule.retrieveOrder(orderId, {
      select: ["id", "currency_code", "total", "metadata"],
    })
    const metadata = metadataObject(order.metadata)
    const paymentIntentId = String(metadata.stripe_payment_intent_id || "")
    if (!paymentIntentId || metadata.final_charge_status !== "succeeded") {
      return res.status(409).json({
        message: "Order does not have a succeeded Stripe final charge to refund.",
      })
    }

    const currencyCode = String(order.currency_code || "usd")
    const capturedAmount = Number(
      metadata.final_total ||
        metadata.final_order_total ||
        metadata.final_charge_amount ||
        order.total ||
        0
    )
    const alreadyRefunded = Number(metadata.final_charge_refunded_amount || 0)
    const refundableAmount = Math.max(0, capturedAmount - alreadyRefunded)
    const refundAmount = numericAmount(body.amount) ?? refundableAmount

    if (refundAmount <= 0 || refundAmount > refundableAmount + 0.005) {
      return res.status(422).json({
        message: `Refund amount exceeds the refundable final-charge balance of ${refundableAmount.toFixed(2)}.`,
      })
    }

    const idempotencyKey =
      requestHeader(req, "Idempotency-Key") ||
      `final-charge-refund:${order.id}:${paymentIntentId}:${refundAmount}`
    const refund = await createStripeRefund({
      paymentIntentId,
      amount: refundAmount,
      currencyCode,
      orderId: order.id,
      note: body.note,
      idempotencyKey,
    })
    const requestKey = `refund:${refund.id}`
    const amountMinor = amountInMinorUnits(refundAmount, currencyCode)

    const existingTransactions = await orderModule.listOrderTransactions(
      {
        order_id: order.id,
        reference: "refund",
        reference_id: refund.id,
      },
      { select: ["id"] }
    )
    if (!existingTransactions.length) {
      await orderModule.addOrderTransactions({
        order_id: order.id,
        amount: -Math.abs(refundAmount),
        currency_code: currencyCode,
        reference: "refund",
        reference_id: refund.id,
      })
    }

    const nextMetadata = appendAuditLog(
      {
        ...metadata,
        final_charge_refunded_amount: Number(
          (alreadyRefunded + refundAmount).toFixed(2)
        ),
        qbd_posting_required: true,
        qbd_posting_status: "pending_manual",
        qbd_posting_action: "card_refund_accounting_record",
        qbd_posting_amount: amountMinor,
        qbd_posting_request_key: requestKey,
        qbd_posting_requested_at: new Date().toISOString(),
        stripe_refund_id: refund.id,
        stripe_provider_refund_id: refund.id,
      },
      {
        action: "stripe_final_charge_refund",
        status: "queued_for_quickbooks",
        qbd_posting_action: "card_refund_accounting_record",
        qbd_posting_request_key: requestKey,
        qbd_posting_amount: amountMinor,
        refund_id: refund.id,
        stripe_payment_intent_id: paymentIntentId,
        staff_actor_id: (req as any).auth_context?.actor_id,
        note: body.note || null,
      }
    )
    await orderModule.updateOrders(order.id, { metadata: nextMetadata })

    await eventBus.emit({
      name: "payment.refunded",
      data: {
        id: `final_charge:${paymentIntentId}`,
        payment_id: `final_charge:${paymentIntentId}`,
        refund_id: refund.id,
        order_id: order.id,
        amount: refundAmount,
        reason: body.note,
      },
    })

    const allocationLines = (body.allocation_releases || [])
      .filter((line) => line.line_item_id)
      .map((line) => ({
        line_item_id: line.line_item_id!,
        quantity: numericAmount(line.quantity) || 0,
      }))
      .filter((line) => line.quantity > 0)
    const allocationOrderId =
      (body.allocation_releases || []).find((line) => line.order_id)
        ?.order_id || order.id

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

    res.status(200).json({
      payment: {
        id: `final_charge:${paymentIntentId}`,
        provider_id: "pp_stripe_final_charge",
        amount: capturedAmount,
        refunded_amount: alreadyRefunded + refundAmount,
        currency_code: currencyCode,
        status:
          alreadyRefunded + refundAmount >= capturedAmount
            ? "refunded"
            : "partially_refunded",
        refunds: [
          {
            id: refund.id,
            amount: refundAmount,
            raw_amount: { value: String(refundAmount) },
            data: refund,
            provider_refund_id: refund.id,
          },
        ],
      },
    })
  } catch (err) {
    res.status(402).json({
      message:
        err instanceof Error ? err.message : "Stripe final-charge refund failed.",
    })
  }
}
