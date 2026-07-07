import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../ops-alert"
import { recordCommunicationEvent } from "./core"

type KnexLike = any

/**
 * The two-person rule for big sends: any campaign whose audience exceeds
 * the threshold needs a human approval before it fires. Approval happens
 * in Slack (#decisions) — an Approve/Reject card posted by this module,
 * clicked by an allow-listed approver (Avi/Peter), handled by the signed
 * interactivity webhook. Flows are exempt (they were approved when
 * activated); test sends are exempt (single recipient).
 */

export const CAMPAIGN_APPROVE_ACTION_ID = "campaign_approve"
export const CAMPAIGN_REJECT_ACTION_ID = "campaign_reject"

export function approvalThreshold(): number {
  const raw = Number(process.env.COMMS_APPROVAL_THRESHOLD || 500)
  return Number.isFinite(raw) && raw > 0 ? raw : 500
}

export function campaignNeedsApproval(input: {
  audienceCount: number
  approvedBy?: string | null
  testEmail?: string | null
}): boolean {
  if (input.testEmail) return false
  if (input.approvedBy) return false
  return input.audienceCount > approvalThreshold()
}

/** Slack user ids allowed to approve (same list the /gp command trusts). */
export function allowedApprovers(): Set<string> {
  return new Set(
    String(process.env.SLACK_GP_ALLOWED_USER_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
}

const DECISIONS_CHANNEL =
  process.env.SLACK_DECISIONS_CHANNEL_ID || "C0BBXAE2RLJ"
const SLACK_POST_TIMEOUT_MS = 3000

export function buildApprovalBlocks(input: {
  campaignId: string
  campaignName: string
  subject: string
  segmentKey: string | null
  audienceCount: number
}): Record<string, unknown>[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:incoming_envelope: *Campaign approval needed*\n` +
          `*${input.campaignName}*\n` +
          `Subject: ${input.subject}\n` +
          `Audience: *${input.audienceCount.toLocaleString()}* recipients` +
          (input.segmentKey ? ` (segment \`${input.segmentKey}\`)` : "") +
          `\nThreshold: sends over ${approvalThreshold()} need a second pair of eyes.`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅ Approve & send" },
          action_id: CAMPAIGN_APPROVE_ACTION_ID,
          value: input.campaignId,
        },
        {
          type: "button",
          style: "danger",
          text: { type: "plain_text", text: "✋ Reject" },
          action_id: CAMPAIGN_REJECT_ACTION_ID,
          value: input.campaignId,
        },
      ],
    },
  ]
}

/**
 * Post the approval card to #decisions. Fail-soft: a Slack outage must not
 * strand the campaign silently — we alert, and the staff console still
 * shows pending_approval with a "re-request" path.
 */
export async function requestCampaignApproval(
  db: KnexLike,
  campaign: Record<string, any>,
  audienceCount: number
): Promise<{ posted: boolean }> {
  const token = process.env.SLACK_BOT_TOKEN
  const blocks = buildApprovalBlocks({
    campaignId: campaign.id,
    campaignName: campaign.name || campaign.subject || campaign.id,
    subject: campaign.subject || "",
    segmentKey: campaign.segment_key || null,
    audienceCount,
  })

  await db("gp_campaign").where("id", campaign.id).update({
    status: "pending_approval",
    metadata: {
      ...(campaign.metadata || {}),
      approval_requested_at: new Date().toISOString(),
      approval_audience_count: audienceCount,
    },
    updated_at: new Date(),
  })

  await recordCommunicationEvent(db, {
    event_name: "campaign_approval_requested",
    campaign_id: campaign.id,
    source: "admin",
    properties: { audience_count: audienceCount },
  })

  if (!token) {
    await emitOpsAlert({
      alertKind: "communications_approval_post_failed",
      severity: "warn",
      title: "Campaign approval request could not post to Slack",
      path: "src/lib/communications/approvals.ts",
      fingerprint: `comms_approval:no_token`,
      meta: { campaign_id: campaign.id, reason: "missing_bot_token" },
    }).catch(() => {})
    return { posted: false }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), SLACK_POST_TIMEOUT_MS)
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: DECISIONS_CHANNEL,
        text: `Campaign approval needed: ${campaign.name || campaign.id}`,
        blocks,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const body: any = await response.json().catch(() => ({}))
    if (!body?.ok) {
      throw new Error(String(body?.error || `http_${response.status}`))
    }
    return { posted: true }
  } catch (error: any) {
    await emitOpsAlert({
      alertKind: "communications_approval_post_failed",
      severity: "warn",
      title: "Campaign approval request could not post to Slack",
      path: "src/lib/communications/approvals.ts",
      fingerprint: `comms_approval:post_failed`,
      meta: {
        campaign_id: campaign.id,
        message: String(error?.message || error).slice(0, 200),
      },
    }).catch(() => {})
    return { posted: false }
  }
}

export type CampaignApprovalDecision = {
  ok: boolean
  status?: string
  reason?: string
}

/** Approve from Slack: flips the campaign and enqueues the real send. */
export async function approveCampaignFromSlack(
  container: MedusaContainer,
  campaignId: string,
  byUser: string,
  byName?: string
): Promise<CampaignApprovalDecision> {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as KnexLike
  const campaign = await db("gp_campaign")
    .whereNull("deleted_at")
    .where("id", campaignId)
    .first()
  if (!campaign) return { ok: false, reason: "not_found" }
  if (campaign.status === "sent") return { ok: false, reason: "already_sent" }

  const approvedBy = `slack:${byUser}${byName ? `(${byName})` : ""}`
  await db("gp_campaign").where("id", campaignId).update({
    status: "approved",
    approved_by: approvedBy,
    approved_at: new Date(),
    updated_at: new Date(),
  })
  await recordCommunicationEvent(db, {
    event_name: "campaign_approved",
    campaign_id: campaignId,
    source: "slack",
    properties: { by_user: byUser, by_name: byName || null },
  })

  // Queue when workers are configured; direct send as the fallback so an
  // approval NEVER lands in a void.
  const { enqueueCampaignSend, queuesConfigured } = await import("./queue.js")
  if (queuesConfigured()) {
    await enqueueCampaignSend(campaignId, {
      approved_by: approvedBy,
      job_id: `campaign:${campaignId}:approved:${Date.now()}`,
    })
  } else {
    const { sendCampaign } = await import("./admin.js")
    await sendCampaign(container, campaignId, { approved_by: approvedBy })
  }
  return { ok: true, status: "approved" }
}

export async function rejectCampaignFromSlack(
  container: MedusaContainer,
  campaignId: string,
  byUser: string,
  byName?: string
): Promise<CampaignApprovalDecision> {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as KnexLike
  const campaign = await db("gp_campaign")
    .whereNull("deleted_at")
    .where("id", campaignId)
    .first()
  if (!campaign) return { ok: false, reason: "not_found" }
  if (campaign.status === "sent") return { ok: false, reason: "already_sent" }

  await db("gp_campaign").where("id", campaignId).update({
    status: "draft",
    metadata: {
      ...(campaign.metadata || {}),
      rejected_by: `slack:${byUser}${byName ? `(${byName})` : ""}`,
      rejected_at: new Date().toISOString(),
    },
    updated_at: new Date(),
  })
  await recordCommunicationEvent(db, {
    event_name: "campaign_rejected",
    campaign_id: campaignId,
    source: "slack",
    properties: { by_user: byUser, by_name: byName || null },
  })
  return { ok: true, status: "draft" }
}
