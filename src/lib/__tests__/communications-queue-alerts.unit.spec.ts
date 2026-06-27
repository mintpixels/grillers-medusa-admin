import { emitOpsAlert } from "../ops-alert"
import { emitCommunicationWorkerJobFailedAlert } from "../communications/queue"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

describe("communications queue ops alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("emits a safe alert when a queued communications worker job fails", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }

    await emitCommunicationWorkerJobFailedAlert({
      workerName: "gp-communications-events",
      logger: logger as any,
      error: new Error("flow rejected avi@example.com"),
      job: {
        id: "evt_123",
        name: "communication-event",
        attemptsMade: 3,
        opts: { attempts: 5 },
        data: {
          event_id: "evt_123",
          event_name: "checkout_started",
          order_id: "order_123",
          cart_id: "cart_123",
          campaign_id: "camp_123",
          flow_id: "flow_123",
          message_id: "gpmsg_123",
          template_key: "cart-abandoned-1",
          profile_id: "gpcprof_123",
          medusa_customer_id: "cus_123",
          email: "avi@example.com",
        },
      } as any,
    })

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_worker_job_failed",
        severity: "warn",
        title: "Communications worker gp-communications-events job evt_123 failed",
        path: "src/lib/communications/queue.ts:startCommunicationWorkers",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          worker_name: "gp-communications-events",
          job_id: "evt_123",
          job_name: "communication-event",
          attempts_made: 3,
          max_attempts: 5,
          event_id: "evt_123",
          event_name: "checkout_started",
          order_id: "order_123",
          cart_id: "cart_123",
          campaign_id: "camp_123",
          flow_id: "flow_123",
          message_id: "gpmsg_123",
          template_key: "cart-abandoned-1",
          has_profile_id: true,
          has_medusa_customer_id: true,
          error: "flow rejected [redacted-email]",
        }),
      })
    )

    const meta = (emitOpsAlert as jest.Mock).mock.calls[0][0].meta
    expect(JSON.stringify(meta)).not.toContain("avi@example.com")
  })
})
