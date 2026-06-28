import { createHash } from "node:crypto"
import type { Logger } from "@medusajs/framework/types"
import { emitOpsAlert } from "../../../../lib/ops-alert"

type SlackAlertLogger = Pick<Logger, "warn" | "error">

type SlackAlertError = {
  error_name: string
  error_code: string | null
  error_message_hash: string | null
}

function safeSlug(value: unknown, fallback = "unknown"): string {
  const slug =
    typeof value === "string"
      ? value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
      : ""
  return slug ? slug.slice(0, 80) : fallback
}

function errorMeta(error: unknown): SlackAlertError {
  const anyError = error as { code?: unknown }
  const message = error instanceof Error ? error.message : String(error ?? "")
  return {
    error_name: error instanceof Error ? error.name : typeof error,
    error_code:
      typeof anyError?.code === "string" && anyError.code
        ? anyError.code.slice(0, 80)
        : null,
    // Keep grouping/debug value without sending raw exception text, which may
    // carry an email, order id, or user-entered Slack argument.
    error_message_hash: message
      ? createHash("sha1").update(message).digest("hex")
      : null,
  }
}

export function emitSlackCommandLookupFailedAlert(input: {
  subcommand: string
  hasArgument: boolean
  error: unknown
  logger?: SlackAlertLogger
}) {
  const subcommand = safeSlug(input.subcommand)
  return emitOpsAlert({
    alertKind: "slack_command_lookup_failed",
    title: `Slack /gp ${subcommand} lookup failed`,
    path: "/webhooks/slack/command",
    severity: "warn",
    fingerprint: `slack_command_lookup_failed:${subcommand}`,
    meta: {
      slack_command: "/gp",
      slack_subcommand: subcommand,
      has_argument: input.hasArgument,
      ...errorMeta(input.error),
    },
    logger: input.logger,
  })
}

export function emitSlackCommandHandlerFailedAlert(input: {
  subcommand?: string | null
  hasArgument?: boolean
  error: unknown
  logger?: SlackAlertLogger
}) {
  const subcommand = safeSlug(input.subcommand)
  return emitOpsAlert({
    alertKind: "slack_command_handler_failed",
    title: "Slack /gp command handler failed",
    path: "/webhooks/slack/command",
    severity: "warn",
    fingerprint: "slack_command_handler_failed",
    meta: {
      slack_command: "/gp",
      slack_subcommand: subcommand,
      has_argument: Boolean(input.hasArgument),
      ...errorMeta(input.error),
    },
    logger: input.logger,
  })
}

export function emitSlackStaffAuthFailedAlert(input: {
  reason: string
  stage: string
  error?: unknown
  logger?: SlackAlertLogger
}) {
  const reason = safeSlug(input.reason)
  return emitOpsAlert({
    alertKind: "slack_staff_auth_failed",
    title: "Slack /gp staff authorization failed",
    path: "/webhooks/slack/command",
    severity: "warn",
    fingerprint: `slack_staff_auth_failed:${reason}`,
    meta: {
      slack_command: "/gp",
      auth_reason: reason,
      auth_stage: safeSlug(input.stage),
      ...(input.error === undefined ? {} : errorMeta(input.error)),
    },
    logger: input.logger,
  })
}

export function emitSlackOrderHoldMissingAlert(input: {
  action: "hold" | "release"
  orderId: string
  logger?: SlackAlertLogger
}) {
  return emitOpsAlert({
    alertKind: "slack_order_hold_order_missing",
    title: `Slack order ${input.action} skipped because order was not found`,
    path: "/webhooks/slack/interactivity",
    severity: "warn",
    fingerprint: `slack_order_hold_order_missing:${input.action}`,
    meta: {
      slack_action: `order_${input.action}`,
      order_id: input.orderId,
    },
    logger: input.logger,
  })
}

export function emitSlackInteractivityHandlerFailedAlert(input: {
  actionId?: string | null
  orderId?: string | null
  error: unknown
  logger?: SlackAlertLogger
}) {
  const actionId = safeSlug(input.actionId, "unknown")
  return emitOpsAlert({
    alertKind: "slack_interactivity_handler_failed",
    title: "Slack interactivity handler failed",
    path: "/webhooks/slack/interactivity",
    severity: "warn",
    fingerprint: `slack_interactivity_handler_failed:${actionId}`,
    meta: {
      slack_action: actionId,
      order_id: input.orderId ?? null,
      ...errorMeta(input.error),
    },
    logger: input.logger,
  })
}
