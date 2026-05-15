import { Modules } from "@medusajs/framework/utils"
import {
  DEFAULT_PAYMENT_METHOD_METADATA_KEY,
  STRIPE_PROVIDER_ID,
  assertPaymentMethodBelongsToCustomer,
  getOrCreateStripeAccountHolder,
  getStripeAccountHolder,
  getStripeCustomerId,
  listStripePaymentMethods,
  setCustomerDefaultPaymentMethod,
} from "../utils"

function makeReq(resolvers: Record<string, unknown>) {
  return {
    scope: {
      resolve: jest.fn((key: string) => {
        if (!(key in resolvers)) {
          throw new Error(`Unexpected resolver: ${key}`)
        }
        return resolvers[key]
      }),
    },
  } as any
}

describe("payment-method route utils", () => {
  it("selects only the Stripe account holder", () => {
    const customer = {
      id: "cus_local",
      account_holders: [
        { id: "ach_other", provider_id: "pp_other", external_id: "other" },
        { id: "ach_stripe", provider_id: STRIPE_PROVIDER_ID, external_id: "cus_123" },
      ],
    }

    expect(getStripeAccountHolder(customer as any)).toMatchObject({
      id: "ach_stripe",
      external_id: "cus_123",
    })
  })

  it("prefers provider data id over external id for Stripe customer id", () => {
    expect(
      getStripeCustomerId({
        external_id: "cus_external",
        data: { id: "cus_from_data" },
      })
    ).toBe("cus_from_data")

    expect(getStripeCustomerId({ external_id: "cus_external" })).toBe(
      "cus_external"
    )
  })

  it("lists Stripe payment methods and marks the stored default", async () => {
    const paymentModule = {
      listPaymentMethods: jest.fn().mockResolvedValue([
        { id: "pm_1", data: { card: { last4: "4242" } } },
        { id: "pm_2", data: { card: { last4: "1881" } } },
      ]),
    }
    const req = makeReq({ [Modules.PAYMENT]: paymentModule })
    const accountHolder = {
      id: "ach_stripe",
      provider_id: STRIPE_PROVIDER_ID,
      data: { id: "cus_stripe" },
    }
    const customer = {
      id: "cus_local",
      metadata: { [DEFAULT_PAYMENT_METHOD_METADATA_KEY]: "pm_2" },
      account_holders: [accountHolder],
    }

    await expect(listStripePaymentMethods(req, customer as any)).resolves.toEqual([
      {
        id: "pm_1",
        provider_id: STRIPE_PROVIDER_ID,
        is_default: false,
        data: { card: { last4: "4242" } },
      },
      {
        id: "pm_2",
        provider_id: STRIPE_PROVIDER_ID,
        is_default: true,
        data: { card: { last4: "1881" } },
      },
    ])

    expect(paymentModule.listPaymentMethods).toHaveBeenCalledWith({
      provider_id: STRIPE_PROVIDER_ID,
      context: {
        account_holder: accountHolder,
        customer,
      },
    })
  })

  it("checks payment method ownership from the authenticated customer's methods", async () => {
    const paymentModule = {
      listPaymentMethods: jest.fn().mockResolvedValue([
        { id: "pm_owner", data: {} },
      ]),
    }
    const req = makeReq({ [Modules.PAYMENT]: paymentModule })
    const customer = {
      id: "cus_local",
      metadata: {},
      account_holders: [
        { id: "ach_stripe", provider_id: STRIPE_PROVIDER_ID, data: { id: "cus_stripe" } },
      ],
    }

    await expect(
      assertPaymentMethodBelongsToCustomer(req, customer as any, "pm_owner")
    ).resolves.toBe(true)
    await expect(
      assertPaymentMethodBelongsToCustomer(req, customer as any, "pm_other")
    ).resolves.toBe(false)
  })

  it("updates and clears the default payment method metadata without dropping other metadata", async () => {
    const customerModule = {
      updateCustomers: jest.fn().mockResolvedValue(undefined),
    }
    const req = makeReq({ [Modules.CUSTOMER]: customerModule })
    const customer = {
      id: "cus_local",
      metadata: {
        source: "test",
        [DEFAULT_PAYMENT_METHOD_METADATA_KEY]: "pm_old",
      },
    }

    await setCustomerDefaultPaymentMethod(req, customer as any, "pm_new")
    expect(customerModule.updateCustomers).toHaveBeenLastCalledWith("cus_local", {
      metadata: {
        source: "test",
        [DEFAULT_PAYMENT_METHOD_METADATA_KEY]: "pm_new",
      },
    })

    await setCustomerDefaultPaymentMethod(req, customer as any)
    expect(customerModule.updateCustomers).toHaveBeenLastCalledWith("cus_local", {
      metadata: { source: "test" },
    })
  })

  it("creates and links a Stripe account holder when the customer does not have one", async () => {
    const accountHolder = {
      id: "ach_new",
      provider_id: STRIPE_PROVIDER_ID,
      data: { id: "cus_new" },
    }
    const paymentModule = {
      createAccountHolder: jest.fn().mockResolvedValue(accountHolder),
    }
    const link = {
      create: jest.fn().mockResolvedValue(undefined),
    }
    const req = makeReq({
      [Modules.PAYMENT]: paymentModule,
      link,
    })
    const customer = {
      id: "cus_local",
      email: "customer@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      phone: "4045550100",
      company_name: null,
      account_holders: [],
    }

    await expect(
      getOrCreateStripeAccountHolder(req, customer as any)
    ).resolves.toEqual(accountHolder)

    expect(paymentModule.createAccountHolder).toHaveBeenCalledWith({
      provider_id: STRIPE_PROVIDER_ID,
      context: {
        customer: {
          id: "cus_local",
          email: "customer@example.com",
          first_name: "Ada",
          last_name: "Lovelace",
          phone: "4045550100",
          company_name: null,
        },
      },
    })
    expect(link.create).toHaveBeenCalledWith({
      [Modules.CUSTOMER]: { customer_id: "cus_local" },
      [Modules.PAYMENT]: { account_holder_id: "ach_new" },
    })
  })
})
