import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../ops-alert"
import { emitStaleQbdPostingAlertFromDb } from "../qbd-pending-posting-alerts"

jest.mock("../ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

jest.mock("../qbd-pending-posting-alerts", () => ({
  emitStaleQbdPostingAlertFromDb: jest.fn(),
}))

const qbdPendingPostingMonitor =
  require("../../jobs/qbd-pending-posting-monitor").default
const { config } = require("../../jobs/qbd-pending-posting-monitor")

function makeContainer() {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
  const db = jest.fn()
  return {
    db,
    logger,
    container: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
        throw new Error(`Unexpected resolve(${key})`)
      },
    },
  }
}

describe("QBD pending posting scheduled monitor", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(emitStaleQbdPostingAlertFromDb as jest.Mock).mockResolvedValue({
      emitted: false,
      candidateCount: 0,
    })
  })

  it("is configured to scan every 30 minutes", () => {
    expect(config).toEqual({
      name: "qbd-pending-posting-monitor",
      schedule: "*/30 * * * *",
    })
  })

  it("runs the DB-backed stale-posting scan", async () => {
    ;(emitStaleQbdPostingAlertFromDb as jest.Mock).mockResolvedValueOnce({
      emitted: true,
      staleOrderCount: 2,
      candidateCount: 2,
    })
    const { container, db, logger } = makeContainer()

    await qbdPendingPostingMonitor(container)

    expect(emitStaleQbdPostingAlertFromDb).toHaveBeenCalledWith({
      db,
      logger,
      path: "src/jobs/qbd-pending-posting-monitor.ts",
    })
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"staleOrderCount":2')
    )
  })

  it("alerts and rethrows when the monitor cannot scan", async () => {
    ;(emitStaleQbdPostingAlertFromDb as jest.Mock).mockRejectedValueOnce(
      new Error("database unavailable for avi@example.com")
    )
    const { container, logger } = makeContainer()

    await expect(qbdPendingPostingMonitor(container)).rejects.toThrow(
      "database unavailable"
    )

    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "qbd_pending_posting_monitor_failed",
        severity: "warn",
        title: "QBD pending posting monitor failed",
        path: "src/jobs/qbd-pending-posting-monitor.ts",
        logger,
        meta: expect.objectContaining({
          job_name: "qbd-pending-posting-monitor",
          error_message: "database unavailable for [redacted-email]",
        }),
      })
    )
  })
})
