import { Modules } from "@medusajs/framework/utils";
import { POST } from "../route";
import {
  getOrCreateStripeAccountHolder,
  getPaymentContextCustomer,
  handleRouteError,
} from "../../utils";

jest.mock("../../utils", () => ({
  STRIPE_PROVIDER_ID: "pp_stripe_stripe",
  getOrCreateStripeAccountHolder: jest.fn(),
  getPaymentContextCustomer: jest.fn(),
  handleRouteError: jest.fn(),
  jsonError: jest.fn((res: any, status: number, message: string) =>
    res.status(status).json({ message }),
  ),
}));

const getPaymentContextCustomerMock =
  getPaymentContextCustomer as jest.MockedFunction<
    typeof getPaymentContextCustomer
  >;
const getOrCreateStripeAccountHolderMock =
  getOrCreateStripeAccountHolder as jest.MockedFunction<
    typeof getOrCreateStripeAccountHolder
  >;
const handleRouteErrorMock = handleRouteError as jest.MockedFunction<
  typeof handleRouteError
>;

describe("payment method setup intent route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function makeResponse() {
    return {
      status: jest.fn(function status() {
        return this;
      }),
      json: jest.fn(),
    } as any;
  }

  it("routes missing setup-intent client secrets through the alerting error handler", async () => {
    const customer = { id: "cus_123", email: "customer@example.com" };
    const accountHolder = { id: "acct_holder_123" };
    const paymentModule = {
      createPaymentMethods: jest.fn(async () => ({ data: {} })),
    };
    const req = {
      scope: {
        resolve: jest.fn((key: string) => {
          if (key === Modules.PAYMENT) return paymentModule;
          throw new Error(`unexpected dependency ${key}`);
        }),
      },
    } as any;
    const res = makeResponse();

    getPaymentContextCustomerMock.mockResolvedValue({
      customer: customer as any,
      staffCustomer: null,
      staffTargetCustomerId: null,
    });
    getOrCreateStripeAccountHolderMock.mockResolvedValue(accountHolder as any);

    await POST(req, res);

    expect(handleRouteErrorMock).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({
        message: "Payment module did not return a setup intent client secret.",
      }),
      "Could not start a card setup. Please try again.",
    );
    expect(res.json).not.toHaveBeenCalled();
  });
});
