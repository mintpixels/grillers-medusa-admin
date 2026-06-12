import type { ExecArgs } from "@medusajs/framework/types"
import {
  createWwexSpeedshipClientFromEnv,
  type GrillersUpsServiceCode,
} from "../modules/fulfillment/wwex-speedship"

type ArgsMap = Record<string, string | boolean>

const SERVICE_CODES: GrillersUpsServiceCode[] = [
  "GROUND",
  "3_DAY_SELECT",
  "2ND_DAY_AIR",
  "OVERNIGHT",
]

function parseArgs(args: string[] = []): ArgsMap {
  const parsed: ArgsMap = {}
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg.startsWith("--")) continue
    const key = arg.slice(2)
    const next = args[index + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    index += 1
  }
  return parsed
}

function argText(args: ArgsMap, key: string, fallback = ""): string {
  const value = args[key]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function argNumber(args: ArgsMap, key: string, fallback: number): number {
  const parsed = Number(args[key])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function destination(args: ArgsMap) {
  return {
    address_1: argText(args, "address-1", "3838 Oak Lawn Ave"),
    city: argText(args, "city", "HIGHLAND PARK"),
    province: argText(args, "state", "TX"),
    postal_code: argText(args, "postal-code", "75219"),
    country_code: "US",
    company_name: argText(args, "company", "WWEX Smoke Test"),
    first_name: "WWEX",
    last_name: "Smoke Test",
    phone: argText(args, "phone", "2148798521"),
    email: argText(args, "email", ""),
  }
}

function selectedServices(args: ArgsMap): GrillersUpsServiceCode[] {
  const service = argText(args, "service").toUpperCase()
  if (!service || service === "ALL") return SERVICE_CODES
  return SERVICE_CODES.filter((candidate) => candidate === service)
}

async function run(args: string[] = []) {
  const parsed = parseArgs(args)
  const client = createWwexSpeedshipClientFromEnv(process.env, console)
  if (!client) {
    throw new Error(
      [
        "WWEX Speedship is not configured.",
        "Set WWEX_AUTH_URL, WWEX_API_BASE_URL, WWEX_CLIENT_ID, WWEX_CLIENT_SECRET, WWEX_AUDIENCE,",
        "and WWEX_ORIGIN_ADDRESS_1/ORIGIN_CITY/ORIGIN_STATE/ORIGIN_POSTAL_CODE/ORIGIN_PHONE.",
      ].join(" ")
    )
  }

  const shipTo = destination(parsed)
  const weightLb = argNumber(parsed, "weight-lb", 5)
  const shipmentDate = argText(parsed, "shipment-date")
  const services = selectedServices(parsed)

  if (!services.length) {
    throw new Error(
      `Unsupported --service. Use one of ${SERVICE_CODES.join(", ")} or ALL.`
    )
  }

  console.log(
    `WWEX smoke: destination ${shipTo.city}, ${shipTo.province} ${shipTo.postal_code}; ${weightLb} lb`
  )

  for (const serviceCode of services) {
    const quote = await client.quoteSmallpack({
      serviceCode,
      shippingAddress: shipTo,
      packages: [
        {
          package_type: "Estimated cold-chain shipper",
          packed_weight_lb: weightLb,
        },
      ],
      shipmentDate: shipmentDate || null,
      residentialDelivery: true,
      orderDisplayId: "SMOKE",
    })

    console.log(
      [
        serviceCode,
        `wwex=${quote.offer.upsServiceCode}`,
        `rate=${quote.offer.price.currency} ${quote.offer.price.value.toFixed(2)}`,
        quote.offer.transitDays ? `transit=${quote.offer.transitDays}d` : "",
        quote.offer.estimatedDeliveryDate
          ? `eta=${quote.offer.estimatedDeliveryDate}`
          : "",
      ]
        .filter(Boolean)
        .join(" | ")
    )
  }
}

export default async function smokeWwexSpeedship({ args }: ExecArgs) {
  await run(args)
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
