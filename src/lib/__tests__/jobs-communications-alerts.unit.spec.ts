import { emitOpsAlert } from "../ops-alert"
import {
  refreshProfileLifecycle,
  runCommunicationMaintenance,
} from "../communications/admin"
import { runDueFlowEnrollments } from "../communications/flows"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

jest.mock("../communications/admin", () => ({
  refreshProfileLifecycle: jest.fn(),
  runCommunicationMaintenance: jest.fn(),
}))

jest.mock("../communications/flows", () => ({
  runDueFlowEnrollments: jest.fn(),
}))

// Import after mocks are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gpCommunicationsFlowRunner =
  require("../../jobs/gp-communications-flow-runner").default
// eslint-disable-next-line @typescript-eslint/no-var-requires
const gpCommunicationsLifecycle =
  require("../../jobs/gp-communications-lifecycle").default

function makeContainer() {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  return {
    logger,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  }
}

describe("communications scheduled job alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(refreshProfileLifecycle as jest.Mock).mockResolvedValue({ updated: 0 })
    ;(runCommunicationMaintenance as jest.Mock).mockResolvedValue({
      processed: 0,
      errors: 0,
      sent: 0,
      skipped: 0,
      completed: 0,
    })
    ;(runDueFlowEnrollments as jest.Mock).mockResolvedValue({
      processed: 0,
      errors: 0,
      sent: 0,
      skipped: 0,
      completed: 0,
    })
  })

  it("alerts when the flow runner reports errored steps without throwing", async () => {
    ;(runDueFlowEnrollments as jest.Mock).mockResolvedValueOnce({
      processed: 4,
      errors: 2,
      sent: 1,
      skipped: 1,
      completed: 0,
    })
    const { container, logger } = makeContainer()

    await gpCommunicationsFlowRunner(container)

    expect(logger.info).toHaveBeenCalled()
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_flow_step_errors",
        severity: "warn",
        title: "Communications flow runner reported 2 errored step(s)",
        path: "src/jobs/gp-communications-flow-runner.ts",
        source: "medusa-server",
        logger,
        meta: expect.objectContaining({
          job_name: "gp-communications-flow-runner",
          processed: 4,
          errors: 2,
          sent: 1,
          skipped: 1,
          completed: 0,
        }),
      })
    )
  })

  it("alerts when lifecycle maintenance reports errored flow steps", async () => {
    ;(runCommunicationMaintenance as jest.Mock).mockResolvedValueOnce({
      processed: 3,
      errors: 1,
      sent: 2,
      skipped: 0,
      completed: 1,
      segments: { refreshed: 2 },
      carts: { scanned: 5, expired: 2 },
      campaigns: { processed: 0, results: [] },
    })
    const { container } = makeContainer()

    await gpCommunicationsLifecycle(container)

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_flow_step_errors",
        path: "src/jobs/gp-communications-lifecycle.ts",
        meta: expect.objectContaining({
          job_name: "gp-communications-lifecycle",
          processed: 3,
          errors: 1,
          sent: 2,
          skipped: 0,
          completed: 1,
        }),
      })
    )
  })

  it("alerts and rethrows when a scheduled communications job throws", async () => {
    ;(runDueFlowEnrollments as jest.Mock).mockRejectedValueOnce(
      new Error("flow failed for avi@example.com")
    )
    const { container } = makeContainer()

    await expect(gpCommunicationsFlowRunner(container)).rejects.toThrow(
      "flow failed"
    )

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "communications_scheduled_job_failed",
        severity: "warn",
        title:
          "Communications scheduled job gp-communications-flow-runner failed",
        path: "src/jobs/gp-communications-flow-runner.ts",
        meta: expect.objectContaining({
          job_name: "gp-communications-flow-runner",
          error: "flow failed for [redacted-email]",
        }),
      })
    )
    expect(JSON.stringify((emitOpsAlert as jest.Mock).mock.calls[0][0].meta))
      .not.toContain("avi@example.com")
  })
})
