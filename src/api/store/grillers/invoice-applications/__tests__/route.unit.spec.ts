import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: any) {
      this.body = payload
      return this
    },
  }
  return res
}

function makeReq({ customerId = "cus_b2b", body = {}, customerModule }: any) {
  return {
    body,
    auth_context: { actor_id: customerId },
    scope: {
      resolve: (key: string) => {
        if (key === Modules.CUSTOMER) return customerModule
        if (key === "logger")
          return { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
        return undefined
      },
    },
  } as any
}

const okCustomer = (metadata: Record<string, unknown> = {}) => ({
  retrieveCustomer: jest.fn(async () => ({ id: "cus_b2b", metadata })),
  updateCustomers: jest.fn(async () => ({ id: "cus_b2b" })),
})

describe("self-serve invoice-application intake (#291)", () => {
  it("401s when not signed in", async () => {
    const res = makeRes()
    await POST(
      { body: {}, auth_context: {}, scope: { resolve: () => undefined } } as any,
      res
    )
    expect(res.statusCode).toBe(401)
  })

  it("400s on an invalid application", async () => {
    const customerModule = okCustomer()
    const res = makeRes()
    await POST(makeReq({ customerModule, body: { business_name: "" } }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.errors.business_name).toBeDefined()
    expect(customerModule.updateCustomers).not.toHaveBeenCalled()
  })

  it("stores a pending application on the customer", async () => {
    const customerModule = okCustomer()
    const res = makeRes()
    await POST(
      makeReq({
        customerModule,
        body: {
          business_name: "Knesset Israel",
          contact_name: "Dov",
          contact_email: "dov@cki.org",
          requested_credit_limit: "3500",
          methods: ["check"],
        },
      }),
      res
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.status).toBe("pending")
    const update: any = (customerModule.updateCustomers as jest.Mock).mock
      .calls[0][1]
    expect(update.metadata.gp_invoice_application_status).toBe("pending")
    expect(update.metadata.gp_invoice_application).toMatchObject({
      business_name: "Knesset Israel",
      contact_email: "dov@cki.org",
      requested_credit_limit: 3500,
      methods: ["check"],
    })
    expect(update.metadata.gp_invoice_application.submitted_at).toBeDefined()
  })

  it("409s when the account is already approved", async () => {
    const customerModule = okCustomer({ gp_offline_payment_approved: true })
    const res = makeRes()
    await POST(
      makeReq({
        customerModule,
        body: {
          business_name: "X",
          contact_name: "Y",
          contact_email: "y@x.com",
        },
      }),
      res
    )
    expect(res.statusCode).toBe(409)
    expect(customerModule.updateCustomers).not.toHaveBeenCalled()
  })
})
