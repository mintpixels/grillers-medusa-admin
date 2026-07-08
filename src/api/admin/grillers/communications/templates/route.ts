import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  communicationTemplates,
  saveCanvasTemplate,
} from "../../../../../lib/communications/admin"
import { respondAdminCommunicationsRouteFailure } from "../_shared/alerts"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  try {
    // ?key= returns ONE full template row (mjml_source included) so the
    // canvas can load an existing design for editing.
    const key = String((req.query as any)?.key || "").trim()
    if (key) {
      const db = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      const template = await db("gp_email_template")
        .whereNull("deleted_at")
        .where("key", key)
        .first()
      if (!template) {
        res.status(404).json({ error: "template_not_found" })
        return
      }
      res.status(200).json({ template })
      return
    }
    res.status(200).json(await communicationTemplates(req.scope))
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "templates",
      error,
      errorCode: "communication_templates_failed",
    })
  }
}

/** Upsert a canvas-designed (GrapesJS/MJML) template from the staff console. */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  try {
    const body = (req.body ?? {}) as Record<string, any>
    const result = await saveCanvasTemplate(req.scope, {
      key: String(body.key || ""),
      name: String(body.name || body.key || ""),
      subject: String(body.subject || ""),
      preheader: body.preheader ?? null,
      html_body: String(body.html_body || ""),
      text_body: body.text_body ?? null,
      mjml_source: body.mjml_source ?? null,
      canvas_project: body.canvas_project,
      message_stream: body.message_stream || "broadcast",
      saved_by: body.saved_by ?? null,
    })
    res.status(200).json({ ok: true, template: result })
  } catch (error) {
    await respondAdminCommunicationsRouteFailure({
      req,
      res,
      action: "template_save",
      error,
      errorCode: "communication_template_save_failed",
    })
  }
}
