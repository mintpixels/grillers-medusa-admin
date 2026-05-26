type ExperimentLineContext = Record<
  string,
  {
    variant_key: string
    assignment_id: string
  }
>

function parseContext(value: unknown): ExperimentLineContext {
  const candidate =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value)
          } catch {
            return null
          }
        })()
      : value

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {}
  }

  const context: ExperimentLineContext = {}

  for (const [experimentKey, assignment] of Object.entries(candidate)) {
    if (
      !assignment ||
      typeof assignment !== "object" ||
      Array.isArray(assignment)
    ) {
      continue
    }

    const record = assignment as Record<string, unknown>
    if (
      typeof record.variant_key !== "string" ||
      typeof record.assignment_id !== "string"
    ) {
      continue
    }

    context[experimentKey] = {
      variant_key: record.variant_key,
      assignment_id: record.assignment_id,
    }
  }

  return context
}

export function experimentContextFromItem(item: any) {
  return parseContext(item?.metadata?.experiment_context)
}

export function experimentContextFromItems(items: any[] | undefined | null) {
  const context: ExperimentLineContext = {}

  for (const item of items || []) {
    Object.assign(context, experimentContextFromItem(item))
  }

  return Object.keys(context).length ? context : undefined
}
