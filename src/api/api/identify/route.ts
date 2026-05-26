import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  recordCommunicationEvent,
  recordIdentity,
  upsertCustomerProfile,
  verifyServiceApiKey,
} from "../../../lib/communications/core"

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ ok: false, error: "unauthorized" })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const traits = body.traits || body.properties || {}
  const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const profile = await upsertCustomerProfile(db, {
    medusa_customer_id: body.user_id || body.customer_id,
    email: traits.email || body.email,
    first_name: traits.first_name,
    last_name: traits.last_name,
    customer_type: traits.customer_type,
    route_market: traits.route_market,
    metadata: traits,
  })

  if (profile) {
    await recordIdentity(db, profile.id, {
      anonymous_id: body.anonymous_id,
      session_id: body.session_id,
      cart_id: body.cart_id,
      medusa_customer_id: body.user_id || body.customer_id,
      email: traits.email || body.email,
    })
  }

  await recordCommunicationEvent(db, {
    event_name: "identify",
    source: "storefront",
    profile_id: profile?.id,
    medusa_customer_id: body.user_id || body.customer_id,
    anonymous_id: body.anonymous_id,
    session_id: body.session_id,
    cart_id: body.cart_id,
    email: traits.email || body.email,
    properties: traits,
  })

  res.status(202).json({ ok: true, profile_id: profile?.id || null })
}
