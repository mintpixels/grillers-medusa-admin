import { validateFlowSteps } from "../communications/flows"

describe("validateFlowSteps", () => {
  it("accepts the runner's step shapes", () => {
    expect(
      validateFlowSteps([
        { type: "delay", minutes: 240 },
        { type: "exit_if_event", event_name: "order_completed" },
        {
          type: "email",
          template_key: "welcome-1",
          subject: "Hi",
          heading: "Welcome",
        },
        {
          type: "sms",
          template_key: "sms-1",
          body:
            "Griller's Pride holiday specials for {{first_name}}. Reply STOP to unsubscribe.",
        },
      ])
    ).toBeNull()
  })

  it("rejects unknown step types with the step number", () => {
    expect(validateFlowSteps([{ type: "webhook" }])).toContain("step 1")
    expect(validateFlowSteps([{ type: "webhook" }])).toContain("webhook")
  })

  it("rejects a zero-length delay", () => {
    expect(validateFlowSteps([{ type: "delay" }])).toContain("delay")
  })

  it("rejects an email step without content", () => {
    expect(
      validateFlowSteps([
        { type: "email", template_key: "t", subject: "s" },
      ])
    ).toContain("heading")
  })

  it("rejects an empty flow", () => {
    expect(validateFlowSteps([])).toContain("at least one step")
  })

  it("rejects SMS flow copy that drifts into transactional use cases", () => {
    expect(
      validateFlowSteps([
        {
          type: "sms",
          template_key: "order-update",
          body:
            "Griller's Pride: your order is ready. Reply STOP to unsubscribe.",
        },
      ])
    ).toContain("sms_use_case_mismatch")
  })
})
