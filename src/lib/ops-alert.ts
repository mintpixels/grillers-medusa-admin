import { randomUUID } from "node:crypto"
import type { Logger } from "@medusajs/framework/types"

type OpsAlertInput = {
  alertKind: string
  title: string
  path: string
  source?: string
  eventId?: string
  url?: string | null
  meta?: Record<string, unknown>
  logger?: Pick<Logger, "warn" | "error">
}

export async function emitOpsAlert(input: OpsAlertInput) {
  const host = process.env.JITSU_HOST?.replace(/\/+$/, "")
  const secret = process.env.JITSU_SERVER_SECRET

  if (!host || !secret) {
    input.logger?.warn?.(
      `[ops-alert] skipped ${input.alertKind}: JITSU_HOST/JITSU_SERVER_SECRET missing`
    )
    return { ok: false, skipped: true }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1500)
  const payload = {
    event_type: "ops.alert",
    eventn_ctx: {
      event_id: input.eventId || randomUUID(),
      event_timestamp_ms: Date.now(),
      ts: new Date().toISOString(),
      source: input.source || "medusa",
      title: input.title,
      url: input.url || null,
      meta: {
        ...(input.meta || {}),
        alert_kind: input.alertKind,
        path: input.path,
      },
      ops_namespace: "ops_timeline",
    },
  }

  try {
    const response = await fetch(`${host}/api/v1/s2s/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": secret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!response.ok) {
      input.logger?.error?.(
        `[ops-alert] ${input.alertKind} failed: ${response.status} ${response.statusText}`
      )
      return { ok: false, skipped: false }
    }

    return { ok: true, skipped: false }
  } catch (error) {
    input.logger?.error?.(`[ops-alert] ${input.alertKind} failed: ${error}`)
    return { ok: false, skipped: false }
  } finally {
    clearTimeout(timeout)
  }
}
