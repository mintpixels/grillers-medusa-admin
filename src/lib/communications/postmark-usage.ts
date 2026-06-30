export type PostmarkMonthlyLimitConfig = {
  configured: boolean
  limit: number | null
  configuration_warning: boolean
  configuration_error: "missing_postmark_monthly_limit" | "invalid_postmark_monthly_limit" | null
}

export function resolvePostmarkMonthlyLimit(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): PostmarkMonthlyLimitConfig {
  const raw = env.POSTMARK_MONTHLY_LIMIT?.trim()
  if (!raw) {
    return {
      configured: false,
      limit: null,
      configuration_warning: true,
      configuration_error: "missing_postmark_monthly_limit",
    }
  }

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return {
      configured: false,
      limit: null,
      configuration_warning: true,
      configuration_error: "invalid_postmark_monthly_limit",
    }
  }

  return {
    configured: true,
    limit: Math.floor(parsed),
    configuration_warning: false,
    configuration_error: null,
  }
}
