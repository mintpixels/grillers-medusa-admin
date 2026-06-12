import type { ExecArgs, PromotionDTO } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createPromotionsWorkflow,
  updatePromotionsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  FREE_SHIPPING_PROMOTION_SPECS,
  promotionMismatches,
  promotionCreateInput,
} from "./lib/free-shipping-promotions"
import {
  getBooleanArg,
  parseArgs,
} from "./lib/legacy-import-utils"

type PromotionService = {
  listPromotions: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<PromotionDTO[]>
}

function promotionByCode(promotions: PromotionDTO[]) {
  return new Map(promotions.map((promotion) => [promotion.code, promotion]))
}

function describeMismatches(promotions: Map<string | undefined, PromotionDTO>) {
  return FREE_SHIPPING_PROMOTION_SPECS.flatMap((spec) =>
    promotionMismatches(spec, promotions.get(spec.code))
  )
}

async function loadCurrentPromotions(container: ExecArgs["container"]) {
  const promotionModule = container.resolve<PromotionService>(Modules.PROMOTION)

  const promotions = await promotionModule.listPromotions(
    { code: FREE_SHIPPING_PROMOTION_SPECS.map((spec) => spec.code) },
    { relations: ["application_method"] }
  )

  return promotionByCode(promotions)
}

export default async function seedFreeShippingPromotions({
  container,
  args = [],
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const parsed = parseArgs(args)
  const write = getBooleanArg(parsed, ["write", "apply"], false)
  const verifyOnly = getBooleanArg(parsed, ["verify"], !write)

  let current = await loadCurrentPromotions(container)
  const mismatches = describeMismatches(current)

  if (verifyOnly && mismatches.length) {
    logger.error("Free-shipping promotion verification failed.")
    for (const mismatch of mismatches) {
      logger.error(
        `${mismatch.code} ${mismatch.field}: expected ${JSON.stringify(
          mismatch.expected
        )}, got ${JSON.stringify(mismatch.actual)}`
      )
    }
    throw new Error(
      "Free-shipping promotions are missing or do not match the launch contract."
    )
  }

  if (!write) {
    logger.info("Free-shipping promotion verification passed.")
    return
  }

  const missing = FREE_SHIPPING_PROMOTION_SPECS.filter(
    (spec) => !current.has(spec.code)
  )
  const existing = FREE_SHIPPING_PROMOTION_SPECS.filter((spec) =>
    current.has(spec.code)
  )

  if (missing.length) {
    logger.info(`Creating ${missing.length} free-shipping promotion(s).`)
    await createPromotionsWorkflow(container).run({
      input: {
        promotionsData: missing.map(promotionCreateInput),
      },
    })
  }

  const updates = existing
    .filter((spec) => promotionMismatches(spec, current.get(spec.code)).length)
    .map((spec) => ({
      id: current.get(spec.code)!.id,
      code: spec.code,
      type: spec.type,
      status: spec.status,
      is_automatic: spec.is_automatic,
      application_method: spec.application_method,
    }))

  if (updates.length) {
    logger.info(`Updating ${updates.length} free-shipping promotion(s).`)
    await updatePromotionsWorkflow(container).run({
      input: {
        promotionsData: updates,
      },
    })
  }

  current = await loadCurrentPromotions(container)
  const afterMismatches = describeMismatches(current)
  if (afterMismatches.length) {
    for (const mismatch of afterMismatches) {
      logger.error(
        `${mismatch.code} ${mismatch.field}: expected ${JSON.stringify(
          mismatch.expected
        )}, got ${JSON.stringify(mismatch.actual)}`
      )
    }
    throw new Error("Free-shipping promotion write did not converge.")
  }

  logger.info("Free-shipping promotion contract is present and verified.")
}
