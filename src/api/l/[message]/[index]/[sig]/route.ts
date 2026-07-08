import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import crypto from "crypto"
import { verifyLinkToken } from "../../../../../lib/communications/links"

/**
 * Public click-tracking redirect: /l/:message/:index/:sig
 * Verifies the HMAC, records the click in gp_link_click (which powers
 * last-click attribution), stamps message.clicked_at, then 302s to the
 * original UTM-tagged destination stored on the message row.
 * Any failure falls back to the storefront — a marketing link must
 * never dead-end a customer.
 */
const FALLBACK_URL =
  process.env.STOREFRONT_BASE_URL || "https://grillers-medusa-frontend.vercel.app"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const messageId = String(req.params.message || "")
  const index = Number(req.params.index)
  const sig = String(req.params.sig || "")

  try {
    if (
      !messageId ||
      !Number.isInteger(index) ||
      index < 0 ||
      !verifyLinkToken(messageId, index, sig)
    ) {
      res.redirect(302, FALLBACK_URL)
      return
    }

    const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    const message = await db("gp_message_log")
      .whereNull("deleted_at")
      .where("id", messageId)
      .first()
    const links: unknown = message?.metadata?.links
    const url =
      Array.isArray(links) && typeof links[index] === "string"
        ? (links[index] as string)
        : null
    if (!message || !url) {
      res.redirect(302, FALLBACK_URL)
      return
    }

    const now = new Date()
    await db("gp_link_click").insert({
      id: `gplink_${crypto.randomUUID()}`,
      message_log_id: message.id,
      profile_id: message.profile_id || null,
      email_lower: message.email_lower || null,
      campaign_id: message.campaign_id || null,
      flow_id: message.flow_id || null,
      template_key: message.template_key || null,
      url,
      clicked_at: now,
      metadata: { link_index: index },
      created_at: now,
      updated_at: now,
    })
    if (!message.clicked_at) {
      await db("gp_message_log")
        .where("id", message.id)
        .update({ clicked_at: now, updated_at: now })
    }

    res.redirect(302, url)
  } catch {
    res.redirect(302, FALLBACK_URL)
  }
}
