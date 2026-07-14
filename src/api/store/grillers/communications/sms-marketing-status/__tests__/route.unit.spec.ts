import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  SMS_MARKETING_CONSENT_METHOD,
  SMS_MARKETING_CONSENT_PURPOSE,
  SMS_MARKETING_CONSENT_VERSION,
  SMS_MARKETING_DISCLOSURE,
  SMS_MARKETING_PROGRAM,
  SMS_MARKETING_PROVIDER,
} from "../../../../../../lib/communications/core"
import { GET } from "../route"

function makeRes() {
  return {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
}

function makeDb(profile: any, error?: Error) {
  const query: any = {
    whereNull: jest.fn(() => query),
    where: jest.fn(() => query),
    first: jest.fn(async () => {
      if (error) throw error
      return profile
    }),
  }
  const db = jest.fn((table: string) => {
    expect(table).toBe("gp_customer_profile")
    return query
  })
  return { db, query }
}

function makeReq(input: {
  customerId?: string | null
  profile?: any
  error?: Error
  query?: Record<string, string>
}) {
  const { db, query } = makeDb(input.profile, input.error)
  return {
    req: {
      auth_context: input.customerId
        ? { actor_id: input.customerId }
        : {},
      query: input.query || {},
      scope: {
        resolve: jest.fn((key: string) => {
          if (key === ContainerRegistrationKeys.PG_CONNECTION) return db
          throw new Error(`Unexpected dependency: ${key}`)
        }),
      },
    } as any,
    db,
    profileQuery: query,
  }
}

function qualifyingProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: "gpcprof_customer",
    medusa_customer_id: "cus_authenticated",
    phone: "4045550100",
    sms_consent: true,
    sms_consent_at: new Date("2026-07-14T12:00:00.000Z"),
    metadata: {
      sms_consent_version: SMS_MARKETING_CONSENT_VERSION,
      sms_consent_source: "account_profile",
      sms_program: SMS_MARKETING_PROGRAM,
      sms_consent_provider: SMS_MARKETING_PROVIDER,
      sms_consent_purpose: SMS_MARKETING_CONSENT_PURPOSE,
      sms_consent_method: SMS_MARKETING_CONSENT_METHOD,
      sms_consent_text: SMS_MARKETING_DISCLOSURE,
      sms_consent_phone: "4045550100",
    },
    ...overrides,
  }
}

describe("customer marketing SMS status", () => {
  it("requires an authenticated customer even behind middleware", async () => {
    const { req, db } = makeReq({ customerId: null, profile: null })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.statusCode).toBe(401)
    expect(res.headers["cache-control"]).toBe("private, no-store")
    expect(db).not.toHaveBeenCalled()
  })

  it("queries only auth_context.actor_id and returns qualifying subscribed state", async () => {
    const { req, profileQuery } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile(),
      query: { customer_id: "cus_someone_else" },
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(profileQuery.where).toHaveBeenCalledWith(
      "medusa_customer_id",
      "cus_authenticated"
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      status: "subscribed",
      phone: "4045550100",
      consented_at: "2026-07-14T12:00:00.000Z",
      opted_out_at: null,
    })
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })

  it("reports the communications STOP state even when consent evidence remains", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile({
        sms_consent: false,
        sms_consent_at: null,
        metadata: {
          ...qualifyingProfile().metadata,
          // Immutable Medusa evidence can still say subscribed after STOP; the
          // communications column and opt-out timestamp remain authoritative.
          sms_consent_status: "subscribed",
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "4045550100",
        },
      }),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      status: "unsubscribed",
      phone: "4045550100",
      consented_at: null,
      opted_out_at: "2026-07-14T13:00:00.000Z",
    })
  })

  it("does not claim carrier restoration from a later web checkbox alone", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile({
        // A fresh web checkbox can restore local express consent, but only a
        // carrier-managed START can clear the prior Twilio STOP suppression.
        sms_consent_at: new Date("2026-07-14T14:00:00.000Z"),
        metadata: {
          ...qualifyingProfile().metadata,
          sms_consent_at: "2026-07-14T14:00:00.000Z",
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "4045550100",
        },
      }),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.body.status).toBe("unsubscribed")
    expect(res.body.consented_at).toBeNull()
  })

  it("reports subscribed after START is newer than the latest STOP", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile({
        metadata: {
          ...qualifyingProfile().metadata,
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "4045550100",
          sms_consent_restart_at: "2026-07-14T13:30:00.000Z",
        },
      }),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.body.status).toBe("subscribed")
  })

  it("allows fresh web consent after START lifts a STOP without prior v3 consent", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: {
        ...qualifyingProfile(),
        sms_consent: false,
        sms_consent_at: null,
        metadata: {
          sms_consent_status: "not_subscribed",
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "+14045550100",
          sms_consent_restart_at: "2026-07-14T13:30:00.000Z",
          sms_consent_restart_source: "twilio_inbound_start",
          sms_consent_restart_phone: "+14045550100",
        },
      },
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.body).toEqual({
      status: "not_subscribed",
      phone: "4045550100",
      consented_at: null,
      opted_out_at: "2026-07-14T13:00:00.000Z",
    })
  })

  it("returns the carrier-blocked phone after the profile phone changes", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile({
        phone: "7705550100",
        sms_consent: false,
        sms_consent_at: null,
        metadata: {
          ...qualifyingProfile().metadata,
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "4045550100",
        },
      }),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.body).toMatchObject({
      status: "unsubscribed",
      phone: "4045550100",
    })
  })

  it("does not let START on a different phone clear the recorded STOP", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: qualifyingProfile({
        phone: "7705550100",
        sms_consent: false,
        sms_consent_at: null,
        metadata: {
          ...qualifyingProfile().metadata,
          sms_opt_out_at: "2026-07-14T13:00:00.000Z",
          sms_opt_out_phone: "4045550100",
          sms_consent_restart_at: "2026-07-14T13:30:00.000Z",
          sms_consent_restart_phone: "7705550100",
        },
      }),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.body).toMatchObject({
      status: "unsubscribed",
      phone: "4045550100",
    })
  })

  it.each([
    ["missing profile", null],
    ["incomplete consent", qualifyingProfile({ sms_consent_at: null })],
    ["invalid destination", qualifyingProfile({ phone: "1045550100" })],
  ])("fails closed as not_subscribed for %s", async (_label, profile) => {
    const { req } = makeReq({ customerId: "cus_authenticated", profile })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.statusCode).toBe(200)
    expect(res.body.status).toBe("not_subscribed")
    expect(res.body.consented_at).toBeNull()
  })

  it("returns a non-cacheable generic failure when the status read fails", async () => {
    const { req } = makeReq({
      customerId: "cus_authenticated",
      profile: null,
      error: new Error("database details must not leak"),
    })
    const res = makeRes()

    await GET(req, res as any)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({
      type: "server_error",
      message: "Marketing text status is temporarily unavailable.",
    })
    expect(JSON.stringify(res.body)).not.toContain("database details")
    expect(res.headers["cache-control"]).toBe("private, no-store")
  })
})
