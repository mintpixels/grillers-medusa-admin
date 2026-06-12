import { emitOpsAlert } from "../ops-alert"

describe("emitOpsAlert", () => {
  const originalEnv = process.env
  const originalFetch = global.fetch

  afterEach(() => {
    process.env = originalEnv
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it("skips without Jitsu server credentials", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() }
    process.env = { ...originalEnv, JITSU_HOST: "", JITSU_SERVER_SECRET: "" }
    global.fetch = jest.fn() as any

    const result = await emitOpsAlert({
      alertKind: "unit",
      title: "Unit",
      path: "src/lib/ops-alert.ts",
      logger: logger as any,
    })

    expect(result).toEqual({ ok: false, skipped: true })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipped unit"))
  })

  it("sends ops.alert through the Jitsu classic s2s endpoint", async () => {
    process.env = {
      ...originalEnv,
      JITSU_HOST: "https://jitsu.example.com/",
      JITSU_SERVER_SECRET: "secret",
    }
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any

    const result = await emitOpsAlert({
      alertKind: "unit",
      title: "Unit",
      path: "src/lib/ops-alert.ts",
      meta: { order_id: "order_123" },
    })

    expect(result).toEqual({ ok: true, skipped: false })
    expect(global.fetch).toHaveBeenCalledWith(
      "https://jitsu.example.com/api/v1/s2s/event",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Auth-Token": "secret",
        }),
      })
    )
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.event_type).toBe("ops.alert")
    expect(body.eventn_ctx.meta).toMatchObject({
      alert_kind: "unit",
      path: "src/lib/ops-alert.ts",
      order_id: "order_123",
    })
  })
})
