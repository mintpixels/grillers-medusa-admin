import type { CreatePromotionDTO, PromotionDTO } from "@medusajs/framework/types"

export type AutoAppliedPromotionSpec = CreatePromotionDTO & {
  launch_note: string
}

export const FREE_SHIPPING_PROMOTION_SPECS: AutoAppliedPromotionSpec[] = [
  {
    code: "GP_FREESHIP_INREGION",
    type: "standard",
    status: "active",
    is_automatic: false,
    launch_note: "Free regional shipping or delivery when storefront eligibility passes.",
    application_method: {
      type: "fixed",
      target_type: "shipping_methods",
      value: 9999,
      currency_code: "usd",
      allocation: "each",
    },
  },
  {
    code: "GP_FREESHIP_NATIONAL",
    type: "standard",
    status: "active",
    is_automatic: false,
    launch_note: "Free national UPS baseline shipping when storefront eligibility passes.",
    application_method: {
      type: "fixed",
      target_type: "shipping_methods",
      value: 9999,
      currency_code: "usd",
      allocation: "each",
    },
  },
  {
    code: "PLANTPICKUP750",
    type: "standard",
    status: "active",
    is_automatic: false,
    launch_note: "Plant pickup credit applied by the storefront above the launch threshold.",
    application_method: {
      type: "fixed",
      target_type: "order",
      value: 7.5,
      currency_code: "usd",
      allocation: "across",
    },
  },
  {
    code: "GP_SE_PICKUP_CREDIT",
    type: "standard",
    status: "active",
    is_automatic: false,
    launch_note: "Southeast pickup credit applied by the storefront above the launch threshold.",
    application_method: {
      type: "fixed",
      target_type: "order",
      value: 15,
      currency_code: "usd",
      allocation: "across",
    },
  },
]

export function promotionCreateInput(
  spec: AutoAppliedPromotionSpec
): CreatePromotionDTO {
  const { launch_note: _launchNote, ...input } = spec
  return input
}

type PromotionMismatch = {
  code: string
  field: string
  expected: unknown
  actual: unknown
}

function normalizeCurrency(value?: string | null) {
  return value ? value.toLowerCase() : value
}

function assertField(
  mismatches: PromotionMismatch[],
  code: string,
  field: string,
  expected: unknown,
  actual: unknown
) {
  if (expected !== actual) {
    mismatches.push({ code, field, expected, actual })
  }
}

export function promotionMismatches(
  spec: AutoAppliedPromotionSpec,
  actual?: PromotionDTO | null
): PromotionMismatch[] {
  if (!actual) {
    return [
      {
        code: spec.code,
        field: "promotion",
        expected: "present",
        actual: "missing",
      },
    ]
  }

  const mismatches: PromotionMismatch[] = []
  const expectedMethod = spec.application_method
  const actualMethod = actual.application_method

  assertField(mismatches, spec.code, "type", spec.type, actual.type)
  assertField(mismatches, spec.code, "status", spec.status, actual.status)
  assertField(
    mismatches,
    spec.code,
    "is_automatic",
    spec.is_automatic ?? false,
    actual.is_automatic ?? false
  )
  assertField(
    mismatches,
    spec.code,
    "application_method.type",
    expectedMethod.type,
    actualMethod?.type
  )
  assertField(
    mismatches,
    spec.code,
    "application_method.target_type",
    expectedMethod.target_type,
    actualMethod?.target_type
  )
  assertField(
    mismatches,
    spec.code,
    "application_method.allocation",
    expectedMethod.allocation ?? null,
    actualMethod?.allocation ?? null
  )
  assertField(
    mismatches,
    spec.code,
    "application_method.value",
    expectedMethod.value,
    actualMethod?.value
  )
  assertField(
    mismatches,
    spec.code,
    "application_method.currency_code",
    normalizeCurrency(expectedMethod.currency_code),
    normalizeCurrency(actualMethod?.currency_code)
  )

  return mismatches
}
