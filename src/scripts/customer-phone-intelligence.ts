import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  lookupTwilioLineType,
  preparePhoneObservation,
  refreshPhoneCustomerRecommendations,
  refreshPhoneObservationCounts,
  upsertPreparedPhoneObservations,
  type PhoneObservationInput,
  type PreparedPhoneObservation,
} from "../lib/communications/phone-intelligence"
import {
  getBooleanArg,
  getNumberArg,
  getStringArg,
  parseArgs,
} from "./lib/legacy-import-utils"

type KnexLike = any

const DEFAULT_QB_SYNC_DASHBOARD_URL =
  "https://grillers-qb-sync-production.up.railway.app/api/dashboard"

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized.length ? normalized : null
}

function lowerEmail(value: unknown): string | null {
  const normalized = text(value)?.toLowerCase() ?? null
  return normalized && normalized.includes("@") ? normalized : null
}

function dedupePrepared(observations: PreparedPhoneObservation[]) {
  const seen = new Set<string>()
  const deduped: PreparedPhoneObservation[] = []
  for (const observation of observations) {
    if (seen.has(observation.observation_key)) continue
    seen.add(observation.observation_key)
    deduped.push(observation)
  }
  return deduped
}

async function fetchJson(url: string) {
  const response = await fetch(url)
  const textBody = await response.text()
  if (!response.ok) {
    throw new Error(`GET ${url} failed ${response.status}: ${textBody.slice(0, 400)}`)
  }
  return textBody ? JSON.parse(textBody) : null
}

async function collectQbdSyncObservations(
  dashboardUrl: string
): Promise<PreparedPhoneObservation[]> {
  const base = dashboardUrl.replace(/\/+$/, "")
  const rows: PreparedPhoneObservation[] = []
  let page = 1
  let lastPage = 1

  do {
    const data = await fetchJson(
      `${base}/customers?per_page=100&page=${page}&sort=id&direction=asc`
    )

    for (const customer of data.data || []) {
      const observation = preparePhoneObservation({
        source: "qbd_sync_customer",
        source_record_id: text(customer.id) || text(customer.list_id),
        medusa_customer_id: customer.medusa_id,
        qbd_customer_list_id: customer.list_id,
        customer_email_lower: lowerEmail(customer.email),
        first_name: customer.first_name,
        last_name: customer.last_name,
        company_name: customer.company_name,
        phone_field: "qbd_sync_customer.phone",
        phone: customer.phone,
        metadata: {
          qbd_full_name: customer.full_name || null,
        },
      })
      if (observation) rows.push(observation)
    }

    lastPage = Number(data.last_page || page)
    page += 1
  } while (page <= lastPage)

  return rows
}

async function collectDatabaseObservations(
  db: KnexLike
): Promise<PreparedPhoneObservation[]> {
  const result = await db.raw(`
    select
      'medusa_customer' as source,
      c.id as source_record_id,
      c.id as medusa_customer_id,
      null::text as qbd_customer_list_id,
      null::text as legacy_customer_id,
      null::text as profile_id,
      lower(c.email) as customer_email_lower,
      c.first_name,
      c.last_name,
      c.company_name,
      'customer.phone' as phone_field,
      c.phone,
      true as is_primary_customer_phone,
      jsonb_build_object('customer_has_account', c.has_account) as metadata
    from customer c
    where c.deleted_at is null
      and nullif(trim(coalesce(c.phone, '')), '') is not null

    union all

    select
      'medusa_customer_address' as source,
      a.id as source_record_id,
      a.customer_id as medusa_customer_id,
      null::text as qbd_customer_list_id,
      null::text as legacy_customer_id,
      null::text as profile_id,
      lower(c.email) as customer_email_lower,
      coalesce(a.first_name, c.first_name) as first_name,
      coalesce(a.last_name, c.last_name) as last_name,
      coalesce(a.company, c.company_name) as company_name,
      'address.' || coalesce(nullif(a.address_name, ''), a.id) || '.phone' as phone_field,
      a.phone,
      false as is_primary_customer_phone,
      jsonb_build_object(
        'address_name', a.address_name,
        'is_default_shipping', a.is_default_shipping,
        'is_default_billing', a.is_default_billing,
        'postal_code', a.postal_code,
        'province', a.province
      ) as metadata
    from customer_address a
    left join customer c on c.id = a.customer_id and c.deleted_at is null
    where a.deleted_at is null
      and nullif(trim(coalesce(a.phone, '')), '') is not null

    union all

    select
      'legacy_customer_map' as source,
      l.id as source_record_id,
      l.medusa_customer_id,
      l.qbd_customer_list_id,
      l.legacy_customer_id,
      null::text as profile_id,
      l.email_lower as customer_email_lower,
      l.first_name,
      l.last_name,
      null::text as company_name,
      'legacy_customer_map.phone' as phone_field,
      l.phone,
      false as is_primary_customer_phone,
      jsonb_build_object(
        'legacy_username', l.legacy_username,
        'auth_import_status', l.auth_import_status,
        'address_import_status', l.address_import_status
      ) as metadata
    from legacy_customer_map l
    where l.deleted_at is null
      and nullif(trim(coalesce(l.phone, '')), '') is not null

    union all

    select
      'gp_customer_profile' as source,
      p.id as source_record_id,
      p.medusa_customer_id,
      null::text as qbd_customer_list_id,
      null::text as legacy_customer_id,
      p.id as profile_id,
      coalesce(p.email_lower, lower(p.email)) as customer_email_lower,
      p.first_name,
      p.last_name,
      null::text as company_name,
      'gp_customer_profile.phone' as phone_field,
      p.phone,
      true as is_primary_customer_phone,
      jsonb_build_object(
        'sms_consent', p.sms_consent,
        'sms_consent_at', p.sms_consent_at,
        'customer_type', p.customer_type,
        'route_market', p.route_market
      ) as metadata
    from gp_customer_profile p
    where p.deleted_at is null
      and nullif(trim(coalesce(p.phone, '')), '') is not null
  `)

  return (result.rows || [])
    .map((row: PhoneObservationInput) => preparePhoneObservation(row))
    .filter(Boolean) as PreparedPhoneObservation[]
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(items[index], index)
    }
  })
  await Promise.all(workers)
}

async function writeObservations(
  db: KnexLike,
  observations: PreparedPhoneObservation[],
  logger: any
) {
  const written = await upsertPreparedPhoneObservations(db, observations, {
    batchSize: 1000,
    onBatch: (count) => {
      if (count % 5000 === 0 || count === observations.length) {
        logger.info(`Phone intelligence observations written: ${count}`)
      }
    },
  })
  await refreshPhoneObservationCounts(db)
  await refreshPhoneCustomerRecommendations(db)
  return written
}

async function listLookupCandidates(
  db: KnexLike,
  options: { maxLookups: number; forceRefresh: boolean; refreshDays: number }
) {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - options.refreshDays)

  let query = db("gp_phone_number_intelligence")
    .whereNull("deleted_at")
    .where("valid_us", true)
    .whereNotNull("e164")
    .select(
      "id",
      "phone_key",
      "e164",
      "twilio_lookup_status",
      "twilio_lookup_performed_at",
      "source_observation_count"
    )
    .orderBy("source_observation_count", "desc")
    .orderBy("e164", "asc")

  if (!options.forceRefresh) {
    query = query.andWhere((builder: any) => {
      builder
        .whereNull("twilio_lookup_performed_at")
        .orWhere("twilio_lookup_status", "!=", "ok")
        .orWhere("twilio_lookup_performed_at", "<", cutoff)
    })
  }

  if (options.maxLookups > 0) {
    query = query.limit(options.maxLookups)
  }

  return query
}

function twilioCredentials() {
  const user = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID
  const password = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN
  if (!user || !password) {
    throw new Error(
      "Twilio credentials are required. Set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET."
    )
  }
  return { user, password }
}

async function runTwilioLookups(
  db: KnexLike,
  options: {
    maxLookups: number
    forceRefresh: boolean
    refreshDays: number
    concurrency: number
  },
  logger: any
) {
  const credentials = twilioCredentials()
  const candidates = await listLookupCandidates(db, options)
  const statusCounts: Record<string, number> = {}
  let completed = 0

  logger.info(`Twilio line-type lookup candidates: ${candidates.length}`)

  await runWithConcurrency(
    candidates,
    options.concurrency,
    async (candidate: Record<string, any>) => {
      const patch = await lookupTwilioLineType(candidate.e164, credentials)
      await db("gp_phone_number_intelligence")
        .where("phone_key", candidate.phone_key)
        .update(patch)

      completed += 1
      const statusKey = patch.twilio_error_code
        ? `${patch.twilio_lookup_status}:${patch.twilio_error_code}`
        : patch.twilio_lookup_status
      statusCounts[statusKey] = (statusCounts[statusKey] || 0) + 1

      if (completed % 100 === 0 || completed === candidates.length) {
        logger.info(`Twilio line-type lookups completed: ${completed}/${candidates.length}`)
      }
    }
  )

  await refreshPhoneCustomerRecommendations(db)

  return {
    requested: candidates.length,
    completed,
    status_counts: statusCounts,
  }
}

async function summary(db: KnexLike) {
  const [
    phoneRows,
    observationRows,
    recommendationRows,
    lookupStatuses,
    lineTypes,
    recommendationBases,
  ] = await Promise.all([
    db("gp_phone_number_intelligence").whereNull("deleted_at").count({ count: "*" }).first(),
    db("gp_customer_phone_observation").whereNull("deleted_at").count({ count: "*" }).first(),
    db("gp_customer_phone_recommendation").whereNull("deleted_at").count({ count: "*" }).first(),
    db("gp_phone_number_intelligence")
      .whereNull("deleted_at")
      .select("twilio_lookup_status")
      .count({ count: "*" })
      .groupBy("twilio_lookup_status")
      .orderBy("twilio_lookup_status", "asc"),
    db("gp_phone_number_intelligence")
      .whereNull("deleted_at")
      .where("twilio_lookup_status", "ok")
      .select("line_type")
      .count({ count: "*" })
      .groupBy("line_type")
      .orderBy("line_type", "asc"),
    db("gp_customer_phone_recommendation")
      .whereNull("deleted_at")
      .select("recommendation_basis")
      .count({ count: "*" })
      .groupBy("recommendation_basis")
      .orderBy("recommendation_basis", "asc"),
  ])

  return {
    phone_numbers: Number(phoneRows?.count || 0),
    phone_observations: Number(observationRows?.count || 0),
    customer_recommendations: Number(recommendationRows?.count || 0),
    lookup_status_counts: Object.fromEntries(
      lookupStatuses.map((row: Record<string, any>) => [
        row.twilio_lookup_status || "unknown",
        Number(row.count || 0),
      ])
    ),
    line_type_counts: Object.fromEntries(
      lineTypes.map((row: Record<string, any>) => [
        row.line_type || "unknown",
        Number(row.count || 0),
      ])
    ),
    recommendation_basis_counts: Object.fromEntries(
      recommendationBases.map((row: Record<string, any>) => [
        row.recommendation_basis || "unknown",
        Number(row.count || 0),
      ])
    ),
  }
}

export default async function customerPhoneIntelligence({ container }: ExecArgs) {
  const args = parseArgs()
  for (const value of args._ || []) {
    const eq = String(value).indexOf("=")
    if (eq <= 0) continue
    const key = String(value).slice(0, eq)
    const optionValue = String(value).slice(eq + 1)
    if (!(key in args)) {
      args[key] = optionValue
    }
  }
  const positional = new Set(
    (args._ || [])
      .map((value) => String(value).trim().toLowerCase())
      .filter((value) => Boolean(value) && !value.includes("="))
  )
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const apply = getBooleanArg(args, ["apply"], positional.has("apply"))
  const includeQbdSync = getBooleanArg(args, ["qbd-sync"], true)
  const allowQbdSyncFailure = getBooleanArg(args, ["allow-qbd-sync-failure"], false)
  const twilio = getBooleanArg(args, ["twilio"], positional.has("twilio"))
  const maxLookups = getNumberArg(args, ["max-lookups"], 0)
  const concurrency = Math.min(12, Math.max(1, getNumberArg(args, ["concurrency"], 4)))
  const refreshDays = Math.max(1, getNumberArg(args, ["refresh-days"], 365))
  const forceRefresh = getBooleanArg(
    args,
    ["force-refresh"],
    positional.has("force-refresh")
  )
  const qbdSyncDashboardUrl = getStringArg(
    args,
    ["qbd-sync-dashboard-url"],
    DEFAULT_QB_SYNC_DASHBOARD_URL
  )!

  if (twilio && !apply) {
    throw new Error("Refusing paid Twilio lookups without --apply.")
  }

  const dbObservations = await collectDatabaseObservations(db)
  let qbdSyncObservations: PreparedPhoneObservation[] = []
  if (includeQbdSync) {
    try {
      qbdSyncObservations = await collectQbdSyncObservations(qbdSyncDashboardUrl)
    } catch (error: any) {
      if (!allowQbdSyncFailure) throw error
      logger.warn(`Skipping QBD sync phone observations: ${error.message}`)
    }
  }

  const observations = dedupePrepared([...dbObservations, ...qbdSyncObservations])
  const validNumbers = new Set(
    observations.filter((row) => row.valid_us && row.e164).map((row) => row.e164)
  )
  const invalidNumbers = new Set(
    observations.filter((row) => !row.valid_us).map((row) => row.phone_key)
  )

  const inventorySummary = {
    apply,
    sources: {
      medusa_database_observations: dbObservations.length,
      qbd_sync_observations: qbdSyncObservations.length,
    },
    observations: observations.length,
    unique_valid_us_numbers: validNumbers.size,
    unique_invalid_or_non_us_numbers: invalidNumbers.size,
    twilio_requested: twilio,
    twilio_max_lookups: maxLookups,
  }

  logger.info(`Phone intelligence inventory: ${JSON.stringify(inventorySummary)}`)

  let written = 0
  let twilioSummary: Record<string, any> | null = null

  if (apply) {
    written = await writeObservations(db, observations, logger)
    if (twilio) {
      twilioSummary = await runTwilioLookups(
        db,
        { maxLookups, forceRefresh, refreshDays, concurrency },
        logger
      )
    }
  }

  const databaseSummary = apply ? await summary(db) : null

  console.log(
    JSON.stringify(
      {
        ...inventorySummary,
        written_observations: written,
        twilio: twilioSummary,
        database: databaseSummary,
      },
      null,
      2
    )
  )
}
