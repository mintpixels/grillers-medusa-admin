import {
  classifyTwilioLineType,
  normalizePhoneForIntelligence,
  preparePhoneObservation,
  twilioPayloadToPatch,
} from "../communications/phone-intelligence"

describe("communications phone intelligence", () => {
  it("normalizes valid US phone numbers into stable E.164 keys", () => {
    expect(normalizePhoneForIntelligence("(404) 555-0199")).toEqual({
      raw_phone: "(404) 555-0199",
      normalized_digits: "4045550199",
      e164: "+14045550199",
      phone_key: "+14045550199",
      valid_us: true,
      validation_error: null,
    })

    expect(normalizePhoneForIntelligence("1-404-555-0199")?.phone_key).toBe(
      "+14045550199"
    )
  })

  it("keeps invalid numbers without sending them to Twilio", () => {
    expect(normalizePhoneForIntelligence("101")?.valid_us).toBe(false)
    expect(normalizePhoneForIntelligence("101")?.phone_key).toBe("invalid:101")
    expect(normalizePhoneForIntelligence("")?.phone_key).toBeUndefined()
  })

  it("creates stable observation keys from source provenance", () => {
    const first = preparePhoneObservation({
      source: "medusa_customer",
      source_record_id: "cus_123",
      phone_field: "customer.phone",
      phone: "(404) 555-0199",
      customer_email_lower: "AVI@EXAMPLE.COM",
      is_primary_customer_phone: true,
    })
    const second = preparePhoneObservation({
      source: "medusa_customer",
      source_record_id: "cus_123",
      phone_field: "customer.phone",
      phone: "4045550199",
      customer_email_lower: "avi@example.com",
      is_primary_customer_phone: true,
    })

    expect(first?.observation_key).toBe(second?.observation_key)
    expect(first?.customer_email_lower).toBe("avi@example.com")
    expect(first?.is_primary_customer_phone).toBe(true)
  })

  it("only treats Twilio mobile line type as an SMS-capable marketing candidate", () => {
    expect(classifyTwilioLineType("mobile")).toEqual({
      is_probable_mobile: true,
      sms_capable_candidate: true,
      sms_capability_basis: "twilio_line_type_mobile",
    })

    expect(classifyTwilioLineType("landline")).toEqual({
      is_probable_mobile: false,
      sms_capable_candidate: false,
      sms_capability_basis: "twilio_line_type_not_mobile",
    })

    expect(classifyTwilioLineType("nonFixedVoip")).toEqual({
      is_probable_mobile: false,
      sms_capable_candidate: false,
      sms_capability_basis: "twilio_line_type_requires_staff_review",
    })
  })

  it("maps Twilio Lookup v2 payloads into stored audit fields", () => {
    const now = new Date("2026-06-15T02:20:00.000Z")
    expect(
      twilioPayloadToPatch(
        {
          country_code: "US",
          national_format: "(404) 555-0199",
          line_type_intelligence: {
            type: "mobile",
            carrier_name: "Example Wireless",
            mobile_country_code: "310",
            mobile_network_code: "260",
          },
        },
        now
      )
    ).toMatchObject({
      twilio_lookup_status: "ok",
      line_type: "mobile",
      carrier_name: "Example Wireless",
      country_code: "US",
      national_format: "(404) 555-0199",
      is_probable_mobile: true,
      sms_capable_candidate: true,
      sms_capability_basis: "twilio_line_type_mobile",
      updated_at: now,
    })
  })
})
