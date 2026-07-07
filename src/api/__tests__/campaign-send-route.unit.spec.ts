import { POST } from "../admin/grillers/communications/campaigns/[id]/send/route"
import { sendCampaign } from "../../lib/communications/admin"

jest.mock("../../lib/communications/admin", () => ({
  sendCampaign: jest.fn(async () => ({
    sent: 1,
    skipped: 0,
    failed: 0,
    audience_count: 1,
  })),
}))

jest.mock("../admin/grillers/communications/_shared/alerts", () => ({
  emitAdminCommunicationsRouteFailureAlert: jest.fn(async () => undefined),
}))

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(payload: any) {
      res.body = payload
      return res
    },
  }
  return res
}

describe("campaign send route", () => {
  beforeEach(() => jest.clearAllMocks())

  it("NEVER passes the calling actor as approved_by", async () => {
    // The two-person rule: campaignNeedsApproval short-circuits on any
    // truthy approvedBy BEFORE checking audience size, so a route that
    // forwards the caller's identity pre-approves every send and skips
    // the >500 Slack gate entirely. Only approveCampaignFromSlack may
    // produce an approval.
    const req: any = {
      body: {},
      params: { id: "gpcamp_1" },
      scope: {},
      auth_context: { actor_id: "apk_attacker" },
    }
    const res = fakeRes()
    await POST(req, res)

    expect(res.statusCode).toBe(202)
    const opts = (sendCampaign as jest.Mock).mock.calls[0][2]
    expect(opts.approved_by).toBeUndefined()
    expect("approved_by" in opts).toBe(false)
  })

  it("forwards test_email for staff test sends", async () => {
    const req: any = {
      body: { test_email: "operator@grillerspride.com" },
      params: { id: "gpcamp_1" },
      scope: {},
      auth_context: { actor_id: "apk_staff" },
    }
    const res = fakeRes()
    await POST(req, res)

    const opts = (sendCampaign as jest.Mock).mock.calls[0][2]
    expect(opts.test_email).toBe("operator@grillerspride.com")
    expect(opts.approved_by).toBeUndefined()
  })
})
