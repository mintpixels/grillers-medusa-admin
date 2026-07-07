import {
  approvalThreshold,
  campaignNeedsApproval,
  allowedApprovers,
  buildApprovalBlocks,
  CAMPAIGN_APPROVE_ACTION_ID,
  CAMPAIGN_REJECT_ACTION_ID,
} from "../communications/approvals"
import { extractCampaignApprovalAction } from "../../api/webhooks/slack/interactivity/route"

describe("campaign approval gate", () => {
  const previousThreshold = process.env.COMMS_APPROVAL_THRESHOLD
  const previousApprovers = process.env.SLACK_GP_ALLOWED_USER_IDS

  afterEach(() => {
    process.env.COMMS_APPROVAL_THRESHOLD = previousThreshold
    process.env.SLACK_GP_ALLOWED_USER_IDS = previousApprovers
  })

  it("defaults the threshold to 500", () => {
    delete process.env.COMMS_APPROVAL_THRESHOLD
    expect(approvalThreshold()).toBe(500)
  })

  it("requires approval only above the threshold", () => {
    delete process.env.COMMS_APPROVAL_THRESHOLD
    expect(campaignNeedsApproval({ audienceCount: 500 })).toBe(false)
    expect(campaignNeedsApproval({ audienceCount: 501 })).toBe(true)
  })

  it("never gates test sends or already-approved sends", () => {
    expect(
      campaignNeedsApproval({ audienceCount: 5000, testEmail: "a@b.com" })
    ).toBe(false)
    expect(
      campaignNeedsApproval({ audienceCount: 5000, approvedBy: "slack:U1" })
    ).toBe(false)
  })

  it("parses the approver allow-list", () => {
    process.env.SLACK_GP_ALLOWED_USER_IDS = "U0BBZ40R60L, U0BBE0RRV8X"
    const approvers = allowedApprovers()
    expect(approvers.has("U0BBZ40R60L")).toBe(true)
    expect(approvers.has("U0BBE0RRV8X")).toBe(true)
    expect(approvers.has("U_INTRUDER")).toBe(false)
  })

  it("builds blocks carrying the campaign id on both buttons", () => {
    const blocks = buildApprovalBlocks({
      campaignId: "gpcamp_1",
      campaignName: "Launch announcement",
      subject: "We're live",
      segmentKey: "engaged-90d",
      audienceCount: 1234,
    })
    const actions: any = blocks.find((b: any) => b.type === "actions")
    expect(actions.elements).toHaveLength(2)
    for (const el of actions.elements) {
      expect(el.value).toBe("gpcamp_1")
    }
    expect(actions.elements.map((e: any) => e.action_id)).toEqual([
      CAMPAIGN_APPROVE_ACTION_ID,
      CAMPAIGN_REJECT_ACTION_ID,
    ])
  })
})

describe("extractCampaignApprovalAction", () => {
  const payload = (actionId: string, value = "gpcamp_9") =>
    ({
      actions: [{ action_id: actionId, value }],
      user: { id: "U0BBZ40R60L", username: "avi" },
    }) as any

  it("extracts an approve click", () => {
    const action = extractCampaignApprovalAction(payload(CAMPAIGN_APPROVE_ACTION_ID))
    expect(action).toEqual({
      decision: "approve",
      actionId: CAMPAIGN_APPROVE_ACTION_ID,
      campaignId: "gpcamp_9",
      byUser: "U0BBZ40R60L",
      byName: "avi",
    })
  })

  it("extracts a reject click", () => {
    const action = extractCampaignApprovalAction(payload(CAMPAIGN_REJECT_ACTION_ID))
    expect(action?.decision).toBe("reject")
  })

  it("ignores other buttons and empty values", () => {
    expect(extractCampaignApprovalAction(payload("ops_ack"))).toBeNull()
    expect(
      extractCampaignApprovalAction(payload(CAMPAIGN_APPROVE_ACTION_ID, "  "))
    ).toBeNull()
    expect(extractCampaignApprovalAction(null)).toBeNull()
  })
})
