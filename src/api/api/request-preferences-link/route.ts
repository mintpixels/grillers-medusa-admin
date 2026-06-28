import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  requestPreferencesLink,
  verifyServiceApiKey,
} from "../../../lib/communications/core"
import { emitOpsAlert } from "../../../lib/ops-alert"

const ALERT_PATH = "src/api/api/request-preferences-link/route.ts"

function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 300)
}

function headerMap(req: MedusaRequest): Record<string, string> {
  const headers = req.headers as any
  return {
    authorization: headers.authorization || headers.get?.("authorization") || "",
    "x-api-key": headers["x-api-key"] || headers.get?.("x-api-key") || "",
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve("logger")
  if (!verifyServiceApiKey(headerMap(req))) {
    res.status(401).json({ error: "unauthorized" })
    return
  }
  const email = String((req.body as Record<string, any>)?.email || "")
    .trim()
    .toLowerCase()
  if (email) {
    await requestPreferencesLink(req.scope, email).catch((error) => {
      void emitOpsAlert({
        alertKind: "communications_preferences_link_failed",
        severity: "warn",
        title: "Communications preferences link request failed",
        path: ALERT_PATH,
        source: "medusa-server",
        logger,
        meta: {
          has_email: true,
          error_message: redactedErrorMessage(error),
        },
      })
    })
  }
  res.status(202).json({ ok: true })
}
