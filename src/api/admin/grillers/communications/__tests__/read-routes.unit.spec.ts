import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  communicationOverview,
  communicationProfileTimeline,
  communicationReports,
  communicationTemplates,
  searchCommunicationProfiles,
} from "../../../../../lib/communications/admin"
import { communicationQueueHealth } from "../../../../../lib/communications/queue"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/communications/admin", () => ({
  communicationOverview: jest.fn(),
  communicationProfileTimeline: jest.fn(),
  communicationReports: jest.fn(),
  communicationTemplates: jest.fn(),
  createCampaign: jest.fn(),
  searchCommunicationProfiles: jest.fn(),
}))

jest.mock("../../../../../lib/communications/queue", () => ({
  communicationQueueHealth: jest.fn(),
}))

jest.mock("../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

import { GET as campaignsGET } from "../campaigns/route"
import { GET as healthGET } from "../health/route"
import { GET as profileTimelineGET } from "../profiles/[id]/route"
import { GET as profilesGET } from "../profiles/route"
import { GET as reportsGET } from "../reports/route"
import { GET as overviewGET } from "../route"
import { GET as templatesGET } from "../templates/route"

function makeRes() {
  return {
    status: jest.fn(function status(this: any) {
      return this
    }),
    json: jest.fn(),
  } as any
}

function failingDb(message = "database unavailable for customer@example.com") {
  return jest.fn(() => {
    throw new Error(message)
  })
}

function makeReq(input?: {
  query?: Record<string, unknown>
  params?: Record<string, unknown>
  db?: unknown
}) {
  const logger = { error: jest.fn(), warn: jest.fn() }
  const req = {
    auth_context: { actor_id: "staff_123" },
    query: input?.query || {},
    params: input?.params || {},
    scope: {
      resolve: (key: string) => {
        if (key === ContainerRegistrationKeys.LOGGER) return logger
        if (key === ContainerRegistrationKeys.PG_CONNECTION) {
          return input?.db || failingDb()
        }
        throw new Error(`Unknown dependency ${key}`)
      },
    },
  } as any

  return { logger, req }
}

function expectFailedRoute({
  res,
  logger,
  action,
  errorCode,
  meta,
}: {
  res: any
  logger: any
  action: string
  errorCode: string
  meta?: Record<string, unknown>
}) {
  expect(res.status).toHaveBeenCalledWith(500)
  expect(res.json).toHaveBeenCalledWith({ ok: false, error: errorCode })
  expect(emitOpsAlert).toHaveBeenCalledWith(
    expect.objectContaining({
      alertKind: "admin_communications_route_failed",
      severity: "page",
      title: `Admin communications route failed: ${action}`,
      path: "src/api/admin/grillers/communications",
      logger,
      meta: expect.objectContaining({
        action,
        actor_id: "staff_123",
        route_status: 500,
        ...(meta || {}),
      }),
    })
  )
}

describe("admin communications read route alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(communicationQueueHealth as jest.Mock).mockResolvedValue({})
  })

  it("alerts when the overview read fails", async () => {
    ;(communicationOverview as jest.Mock).mockRejectedValueOnce(
      new Error("overview failed for avi@example.com")
    )
    const { logger, req } = makeReq()
    const res = makeRes()

    await overviewGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "overview",
      errorCode: "communications_overview_failed",
    })
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0])).toContain(
      "overview failed for [redacted-email]"
    )
  })

  it("alerts on profile search failures without sending the raw query", async () => {
    ;(searchCommunicationProfiles as jest.Mock).mockRejectedValueOnce(
      new Error("profile lookup unavailable")
    )
    const { logger, req } = makeReq({
      query: { q: "customer@example.com", limit: "10", offset: "5" },
    })
    const res = makeRes()

    await profilesGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "profile_search",
      errorCode: "communication_profile_search_failed",
      meta: { has_query: true, limit: 10, offset: 5 },
    })
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0])).not.toContain(
      "customer@example.com"
    )
  })

  it("alerts on profile timeline failures without sending the profile id", async () => {
    ;(communicationProfileTimeline as jest.Mock).mockRejectedValueOnce(
      new Error("timeline query failed for gpprof_123")
    )
    const { logger, req } = makeReq({ params: { id: "gpprof_123" } })
    const res = makeRes()

    await profileTimelineGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "profile_timeline",
      errorCode: "communication_profile_timeline_failed",
      meta: { has_profile_id: true },
    })
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0])).not.toContain(
      "gpprof_123"
    )
  })

  it("alerts when the communications health read fails", async () => {
    const { logger, req } = makeReq({ db: failingDb("health query failed") })
    const res = makeRes()

    await healthGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "health",
      errorCode: "communications_health_failed",
      meta: { postmark_monthly_limit: 100 },
    })
  })

  it("alerts when reports cannot be read", async () => {
    ;(communicationReports as jest.Mock).mockRejectedValueOnce(
      new Error("reports unavailable")
    )
    const { logger, req } = makeReq({ query: { days: "14" } })
    const res = makeRes()

    await reportsGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "reports",
      errorCode: "communication_reports_failed",
      meta: { days: 14 },
    })
  })

  it("alerts when templates cannot be read", async () => {
    ;(communicationTemplates as jest.Mock).mockRejectedValueOnce(
      new Error("templates unavailable")
    )
    const { logger, req } = makeReq()
    const res = makeRes()

    await templatesGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "templates",
      errorCode: "communication_templates_failed",
    })
  })

  it("alerts when campaigns cannot be listed", async () => {
    const { logger, req } = makeReq({
      query: { limit: "25" },
      db: failingDb("campaign listing failed"),
    })
    const res = makeRes()

    await campaignsGET(req, res)

    expectFailedRoute({
      res,
      logger,
      action: "list_campaigns",
      errorCode: "campaign_list_failed",
      meta: { limit: 25 },
    })
  })
})
