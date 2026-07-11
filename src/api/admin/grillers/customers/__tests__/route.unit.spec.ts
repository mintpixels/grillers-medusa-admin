import { Modules } from "@medusajs/framework/utils"
import { POST } from "../route"
import { emitOpsAlert } from "../../../../../lib/ops-alert"

jest.mock("../../../../../lib/ops-alert", () => ({
  emitOpsAlert: jest.fn(async () => ({ ok: true, skipped: false })),
}))

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

function makeReq(body: any, customerModule: any) {
  return {
    body,
    scope: {
      resolve: (key: string) => {
        if (key === Modules.CUSTOMER) return customerModule
        if (key === "logger") return { info: jest.fn(), error: jest.fn() }
        return undefined
      },
    },
  } as any
}

describe("staff create-customer route (#277)", () => {
  beforeEach(() => {
    ;(emitOpsAlert as jest.Mock).mockClear()
  })

  const validBody = {
    first_name: "Peter",
    last_name: "Swerdlow",
    email: "peter@example.com",
    phone: "(404) 555-1234",
    phone_line_type: "mobile",
    postal_code: "30062",
  }

  it("returns 400 with field errors for invalid input", async () => {
    const customerModule = {
      listCustomers: jest.fn(),
      createCustomers: jest.fn(),
    }
    const res = makeRes()
    await POST(
      makeReq({ ...validBody, first_name: "", phone_line_type: "" }, customerModule),
      res
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.errors.first_name).toBeDefined()
    expect(res.body.errors.phone_line_type).toBeDefined()
    expect(customerModule.createCustomers).not.toHaveBeenCalled()
  })

  it("refuses staff-attested SMS marketing consent", async () => {
    const customerModule = {
      listCustomers: jest.fn(),
      createCustomers: jest.fn(),
    }
    const res = makeRes()
    await POST(
      makeReq(
        { ...validBody, sms_marketing_opt_in: true, customer_agreed_to_sms: true },
        customerModule
      ),
      res
    )
    expect(res.statusCode).toBe(400)
    expect(res.body.errors.sms_consent).toContain("Only the customer")
    expect(customerModule.createCustomers).not.toHaveBeenCalled()
  })

  it("returns 409 for a duplicate email instead of a generic server error", async () => {
    const customerModule = {
      listCustomers: jest.fn(async () => [
        { id: "cus_existing", email: "peter@example.com" },
      ]),
      createCustomers: jest.fn(),
    }
    const res = makeRes()
    await POST(makeReq(validBody, customerModule), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.errors.email).toBeDefined()
    expect(res.body.existing_customer_id).toBe("cus_existing")
    expect(customerModule.createCustomers).not.toHaveBeenCalled()
  })

  it("creates a customer with formatted phone, metadata, customer code, and ship-to address", async () => {
    const customerModule = {
      listCustomers: jest.fn(async () => []),
      createCustomers: jest.fn(async (data: any) => ({ id: "cus_new", ...data })),
      createCustomerAddresses: jest.fn(async () => [{ id: "addr_1" }]),
    }
    const res = makeRes()
    await POST(
      makeReq(
        {
          ...validBody,
          company_name: "Swerdlow Holdings LLC",
          address_1: "123 Peachtree St",
          city: "Atlanta",
          province: "GA",
          postal_code: "30303",
        },
        customerModule
      ),
      res
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.customer_code).toBe("Swerdlow, Peter - 30303")

    const createArg = customerModule.createCustomers.mock.calls[0][0]
    expect(createArg.phone).toBe("404-555-1234")
    expect(createArg.has_account).toBe(false)
    expect(createArg.company_name).toBe("Swerdlow Holdings LLC")
    expect(createArg.metadata.gp_customer_code).toBe("Swerdlow, Peter - 30303")
    expect(createArg.metadata.gp_phone_is_mobile).toBe(true)

    expect(customerModule.createCustomerAddresses).toHaveBeenCalledWith([
      expect.objectContaining({
        customer_id: "cus_new",
        province: "GA",
        postal_code: "30303",
        is_default_shipping: true,
        is_default_billing: true,
      }),
    ])
  })

  it("does not create an address when no ship-to is provided", async () => {
    const customerModule = {
      listCustomers: jest.fn(async () => []),
      createCustomers: jest.fn(async (data: any) => ({ id: "cus_new", ...data })),
      createCustomerAddresses: jest.fn(),
    }
    const res = makeRes()
    await POST(makeReq(validBody, customerModule), res)
    expect(res.statusCode).toBe(201)
    expect(customerModule.createCustomerAddresses).not.toHaveBeenCalled()
  })

  it("returns a clean 500 message (not the generic toast) when creation throws", async () => {
    const customerModule = {
      listCustomers: jest.fn(async () => []),
      createCustomers: jest.fn(async () => {
        throw new Error("db constraint violated")
      }),
    }
    const res = makeRes()
    await POST(makeReq(validBody, customerModule), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.message).toContain("Could not create the customer")
    expect(emitOpsAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKind: "staff_customer_create_error",
        severity: "page",
        fingerprint: "staff_customer_create:500",
        meta: expect.objectContaining({
          email_domain: "example.com",
          has_company_name: false,
          has_address: false,
          error_message: "db constraint violated",
        }),
      })
    )
  })
})
