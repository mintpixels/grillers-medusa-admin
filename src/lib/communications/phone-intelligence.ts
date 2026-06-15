import crypto from "crypto"

type KnexLike = any

export type PhoneObservationInput = {
  source: string
  source_record_id?: string | null
  phone_field: string
  phone: unknown
  medusa_customer_id?: string | null
  qbd_customer_list_id?: string | null
  legacy_customer_id?: string | null
  profile_id?: string | null
  customer_email_lower?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  is_primary_customer_phone?: boolean
  metadata?: Record<string, unknown> | null
}

export type NormalizedPhone = {
  raw_phone: string
  normalized_digits: string | null
  e164: string | null
  phone_key: string
  valid_us: boolean
  validation_error: string | null
}

export type PreparedPhoneObservation = PhoneObservationInput &
  NormalizedPhone & {
    observation_key: string
  }

export type TwilioLineTypePatch = {
  twilio_lookup_status: "ok" | "error"
  twilio_lookup_fields: string
  twilio_lookup_performed_at: Date
  twilio_error_code: string | null
  twilio_error_message: string | null
  line_type: string | null
  carrier_name: string | null
  mobile_country_code: string | null
  mobile_network_code: string | null
  country_code: string | null
  national_format: string | null
  is_probable_mobile: boolean
  sms_capable_candidate: boolean
  sms_capability_basis: string
  provider_response: Record<string, unknown> | null
  updated_at: Date
}

const TWILIO_LINE_TYPE_FIELDS = "line_type_intelligence"
const MOBILE_LINE_TYPES = new Set(["mobile"])
const REVIEW_LINE_TYPES = new Set([
  "fixedvoip",
  "nonfixedvoip",
  "voip",
  "personal",
])

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim()
  return normalized.length ? normalized : null
}

function emailLower(value: unknown): string | null {
  const normalized = text(value)?.toLowerCase() ?? null
  return normalized && normalized.includes("@") ? normalized : null
}

function hashKey(parts: Array<unknown>) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join("\x1f"))
    .digest("hex")
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

export function normalizePhoneForIntelligence(value: unknown): NormalizedPhone | null {
  const rawPhone = text(value)
  if (!rawPhone) return null

  let digits = rawPhone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1)
  }

  if (!digits) {
    return {
      raw_phone: rawPhone,
      normalized_digits: null,
      e164: null,
      phone_key: `invalid:${hashKey([rawPhone]).slice(0, 24)}`,
      valid_us: false,
      validation_error: "no_digits",
    }
  }

  const validUs = digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)
  const e164 = validUs ? `+1${digits}` : null

  return {
    raw_phone: rawPhone,
    normalized_digits: digits,
    e164,
    phone_key: e164 || `invalid:${digits}`,
    valid_us: validUs,
    validation_error: validUs ? null : "not_valid_us_phone_number",
  }
}

export function preparePhoneObservation(
  input: PhoneObservationInput
): PreparedPhoneObservation | null {
  const normalized = normalizePhoneForIntelligence(input.phone)
  if (!normalized) return null

  const source = text(input.source)
  const phoneField = text(input.phone_field)
  if (!source || !phoneField) return null

  const observationKey = hashKey([
    source,
    input.source_record_id,
    phoneField,
    normalized.phone_key,
  ])

  return {
    ...input,
    ...normalized,
    source,
    phone_field: phoneField,
    observation_key: observationKey,
    customer_email_lower: emailLower(input.customer_email_lower),
    first_name: text(input.first_name),
    last_name: text(input.last_name),
    company_name: text(input.company_name),
    medusa_customer_id: text(input.medusa_customer_id),
    qbd_customer_list_id: text(input.qbd_customer_list_id),
    legacy_customer_id: text(input.legacy_customer_id),
    profile_id: text(input.profile_id),
    source_record_id: text(input.source_record_id),
    is_primary_customer_phone: Boolean(input.is_primary_customer_phone),
    metadata: input.metadata || null,
  }
}

export function classifyTwilioLineType(lineType: unknown) {
  const normalized = String(lineType || "").trim()
  const key = normalized.toLowerCase()
  const isProbableMobile = MOBILE_LINE_TYPES.has(key)
  const needsReview = REVIEW_LINE_TYPES.has(key)

  return {
    is_probable_mobile: isProbableMobile,
    sms_capable_candidate: isProbableMobile,
    sms_capability_basis: isProbableMobile
      ? "twilio_line_type_mobile"
      : needsReview
        ? "twilio_line_type_requires_staff_review"
        : normalized
          ? "twilio_line_type_not_mobile"
          : "twilio_line_type_unknown",
  }
}

export function twilioPayloadToPatch(
  payload: Record<string, any>,
  now = new Date()
): TwilioLineTypePatch {
  const line = payload.line_type_intelligence || {}
  const lineType = text(line.type)
  const classification = classifyTwilioLineType(lineType)

  return {
    twilio_lookup_status: "ok",
    twilio_lookup_fields: TWILIO_LINE_TYPE_FIELDS,
    twilio_lookup_performed_at: now,
    twilio_error_code: text(line.error_code),
    twilio_error_message: text(line.error_message),
    line_type: lineType,
    carrier_name: text(line.carrier_name),
    mobile_country_code: text(line.mobile_country_code),
    mobile_network_code: text(line.mobile_network_code),
    country_code: text(payload.country_code),
    national_format: text(payload.national_format),
    ...classification,
    provider_response: payload,
    updated_at: now,
  }
}

export function twilioErrorToPatch(
  payload: Record<string, any>,
  statusCode: number,
  now = new Date()
): TwilioLineTypePatch {
  return {
    twilio_lookup_status: "error",
    twilio_lookup_fields: TWILIO_LINE_TYPE_FIELDS,
    twilio_lookup_performed_at: now,
    twilio_error_code: text(payload.code) || String(statusCode),
    twilio_error_message: text(payload.message) || text(payload.more_info),
    line_type: null,
    carrier_name: null,
    mobile_country_code: null,
    mobile_network_code: null,
    country_code: text(payload.country_code),
    national_format: text(payload.national_format),
    is_probable_mobile: false,
    sms_capable_candidate: false,
    sms_capability_basis: "twilio_lookup_error",
    provider_response: payload,
    updated_at: now,
  }
}

export async function lookupTwilioLineType(
  e164: string,
  credentials: { user: string; password: string },
  now = new Date()
): Promise<TwilioLineTypePatch> {
  const auth = Buffer.from(`${credentials.user}:${credentials.password}`).toString(
    "base64"
  )
  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(
    e164
  )}?Fields=${TWILIO_LINE_TYPE_FIELDS}`
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const payload = (await response.json().catch(() => ({}))) as Record<string, any>

  if (!response.ok) {
    return twilioErrorToPatch(payload, response.status, now)
  }

  return twilioPayloadToPatch(payload, now)
}

export async function upsertPreparedPhoneObservation(
  db: KnexLike,
  observation: PreparedPhoneObservation,
  now = new Date()
) {
  const phoneInsert = {
    id: newId("gpphone"),
    phone_key: observation.phone_key,
    e164: observation.e164,
    normalized_digits: observation.normalized_digits,
    valid_us: observation.valid_us,
    validation_error: observation.validation_error,
    first_observed_at: now,
    last_observed_at: now,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }

  await db("gp_phone_number_intelligence")
    .insert(phoneInsert)
    .onConflict("phone_key")
    .merge({
      e164: observation.e164,
      normalized_digits: observation.normalized_digits,
      valid_us: observation.valid_us,
      validation_error: observation.validation_error,
      last_observed_at: now,
      updated_at: now,
      deleted_at: null,
    })

  const phoneRow = await db("gp_phone_number_intelligence")
    .where("phone_key", observation.phone_key)
    .first("id")

  await db("gp_customer_phone_observation")
    .insert({
      id: newId("gpphobs"),
      observation_key: observation.observation_key,
      phone_key: observation.phone_key,
      phone_intelligence_id: phoneRow?.id || null,
      e164: observation.e164,
      normalized_digits: observation.normalized_digits,
      valid_us: observation.valid_us,
      raw_phone: observation.raw_phone,
      source: observation.source,
      source_record_id: observation.source_record_id,
      phone_field: observation.phone_field,
      medusa_customer_id: observation.medusa_customer_id,
      qbd_customer_list_id: observation.qbd_customer_list_id,
      legacy_customer_id: observation.legacy_customer_id,
      profile_id: observation.profile_id,
      customer_email_lower: observation.customer_email_lower,
      first_name: observation.first_name,
      last_name: observation.last_name,
      company_name: observation.company_name,
      is_primary_customer_phone: observation.is_primary_customer_phone,
      metadata: observation.metadata,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .onConflict("observation_key")
    .merge({
      phone_key: observation.phone_key,
      phone_intelligence_id: phoneRow?.id || null,
      e164: observation.e164,
      normalized_digits: observation.normalized_digits,
      valid_us: observation.valid_us,
      raw_phone: observation.raw_phone,
      source_record_id: observation.source_record_id,
      phone_field: observation.phone_field,
      medusa_customer_id: observation.medusa_customer_id,
      qbd_customer_list_id: observation.qbd_customer_list_id,
      legacy_customer_id: observation.legacy_customer_id,
      profile_id: observation.profile_id,
      customer_email_lower: observation.customer_email_lower,
      first_name: observation.first_name,
      last_name: observation.last_name,
      company_name: observation.company_name,
      is_primary_customer_phone: observation.is_primary_customer_phone,
      metadata: observation.metadata,
      updated_at: now,
      deleted_at: null,
    })
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}

export async function upsertPreparedPhoneObservations(
  db: KnexLike,
  observations: PreparedPhoneObservation[],
  options: { batchSize?: number; onBatch?: (written: number) => void } = {}
) {
  const now = new Date()
  const batchSize = Math.max(100, Math.min(2000, options.batchSize || 1000))
  const phonesByKey = new Map<string, PreparedPhoneObservation>()

  for (const observation of observations) {
    if (!phonesByKey.has(observation.phone_key)) {
      phonesByKey.set(observation.phone_key, observation)
    }
  }

  const phoneRows = Array.from(phonesByKey.values()).map((observation) => ({
    id: newId("gpphone"),
    phone_key: observation.phone_key,
    e164: observation.e164,
    normalized_digits: observation.normalized_digits,
    valid_us: observation.valid_us,
    validation_error: observation.validation_error,
    first_observed_at: now,
    last_observed_at: now,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }))

  for (const batch of chunks(phoneRows, batchSize)) {
    await db("gp_phone_number_intelligence")
      .insert(batch)
      .onConflict("phone_key")
      .merge({
        e164: db.raw("excluded.e164"),
        normalized_digits: db.raw("excluded.normalized_digits"),
        valid_us: db.raw("excluded.valid_us"),
        validation_error: db.raw("excluded.validation_error"),
        last_observed_at: now,
        updated_at: now,
        deleted_at: null,
      })
  }

  const phoneIds = new Map<string, string>()
  for (const keyBatch of chunks(Array.from(phonesByKey.keys()), batchSize)) {
    const rows = await db("gp_phone_number_intelligence")
      .whereIn("phone_key", keyBatch)
      .select("id", "phone_key")
    for (const row of rows) {
      phoneIds.set(row.phone_key, row.id)
    }
  }

  let written = 0
  const observationRows = observations.map((observation) => ({
    id: newId("gpphobs"),
    observation_key: observation.observation_key,
    phone_key: observation.phone_key,
    phone_intelligence_id: phoneIds.get(observation.phone_key) || null,
    e164: observation.e164,
    normalized_digits: observation.normalized_digits,
    valid_us: observation.valid_us,
    raw_phone: observation.raw_phone,
    source: observation.source,
    source_record_id: observation.source_record_id,
    phone_field: observation.phone_field,
    medusa_customer_id: observation.medusa_customer_id,
    qbd_customer_list_id: observation.qbd_customer_list_id,
    legacy_customer_id: observation.legacy_customer_id,
    profile_id: observation.profile_id,
    customer_email_lower: observation.customer_email_lower,
    first_name: observation.first_name,
    last_name: observation.last_name,
    company_name: observation.company_name,
    is_primary_customer_phone: observation.is_primary_customer_phone,
    metadata: observation.metadata,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }))

  for (const batch of chunks(observationRows, batchSize)) {
    await db("gp_customer_phone_observation")
      .insert(batch)
      .onConflict("observation_key")
      .merge({
        phone_key: db.raw("excluded.phone_key"),
        phone_intelligence_id: db.raw("excluded.phone_intelligence_id"),
        e164: db.raw("excluded.e164"),
        normalized_digits: db.raw("excluded.normalized_digits"),
        valid_us: db.raw("excluded.valid_us"),
        raw_phone: db.raw("excluded.raw_phone"),
        source_record_id: db.raw("excluded.source_record_id"),
        phone_field: db.raw("excluded.phone_field"),
        medusa_customer_id: db.raw("excluded.medusa_customer_id"),
        qbd_customer_list_id: db.raw("excluded.qbd_customer_list_id"),
        legacy_customer_id: db.raw("excluded.legacy_customer_id"),
        profile_id: db.raw("excluded.profile_id"),
        customer_email_lower: db.raw("excluded.customer_email_lower"),
        first_name: db.raw("excluded.first_name"),
        last_name: db.raw("excluded.last_name"),
        company_name: db.raw("excluded.company_name"),
        is_primary_customer_phone: db.raw("excluded.is_primary_customer_phone"),
        metadata: db.raw("excluded.metadata"),
        updated_at: now,
        deleted_at: null,
      })
    written += batch.length
    options.onBatch?.(written)
  }

  return written
}

export async function refreshPhoneObservationCounts(db: KnexLike) {
  await db.raw(`
    update gp_phone_number_intelligence p
    set
      source_observation_count = obs.source_observation_count,
      customer_observation_count = obs.customer_observation_count,
      first_observed_at = obs.first_observed_at,
      last_observed_at = obs.last_observed_at,
      updated_at = now()
    from (
      select
        phone_key,
        count(*)::numeric as source_observation_count,
        count(distinct coalesce(
          nullif(medusa_customer_id, ''),
          nullif(customer_email_lower, ''),
          nullif(qbd_customer_list_id, ''),
          nullif(legacy_customer_id, ''),
          nullif(profile_id, ''),
          nullif(source_record_id, '')
        ))::numeric as customer_observation_count,
        min(created_at) as first_observed_at,
        max(updated_at) as last_observed_at
      from gp_customer_phone_observation
      where deleted_at is null
      group by phone_key
    ) obs
    where p.phone_key = obs.phone_key
      and p.deleted_at is null
  `)
}

export async function refreshPhoneCustomerRecommendations(db: KnexLike) {
  await db.raw(`
    with candidates as (
      select
        case
          when nullif(obs.medusa_customer_id, '') is not null then 'medusa:' || obs.medusa_customer_id
          when nullif(obs.customer_email_lower, '') is not null then 'email:' || obs.customer_email_lower
          when nullif(obs.qbd_customer_list_id, '') is not null then 'qbd:' || obs.qbd_customer_list_id
          when nullif(obs.legacy_customer_id, '') is not null then 'legacy:' || obs.legacy_customer_id
          when nullif(obs.profile_id, '') is not null then 'profile:' || obs.profile_id
          else null
        end as customer_key,
        obs.medusa_customer_id,
        obs.qbd_customer_list_id,
        obs.legacy_customer_id,
        obs.profile_id,
        obs.customer_email_lower,
        obs.phone_key,
        phone.e164,
        phone.line_type,
        phone.sms_capable_candidate,
        case
          when phone.is_probable_mobile then 'twilio_mobile'
          when phone.sms_capability_basis = 'twilio_line_type_requires_staff_review' then 'staff_review_required'
          when phone.twilio_lookup_status = 'not_requested' then 'lookup_not_run'
          else phone.sms_capability_basis
        end as recommendation_basis,
        (
          case when phone.is_probable_mobile then 100 else 0 end +
          case when obs.is_primary_customer_phone then 20 else 0 end +
          case when obs.source in ('medusa_customer', 'gp_customer_profile') then 10 else 0 end +
          coalesce(phone.source_observation_count, 0)
        ) as score,
        obs.created_at
      from gp_customer_phone_observation obs
      join gp_phone_number_intelligence phone
        on phone.phone_key = obs.phone_key
       and phone.deleted_at is null
      where obs.deleted_at is null
        and phone.valid_us = true
        and phone.e164 is not null
    ),
    counted as (
      select
        customer_key,
        count(distinct phone_key)::numeric as candidate_count,
        count(distinct phone_key) filter (where sms_capable_candidate = true)::numeric as mobile_candidate_count,
        count(distinct phone_key) filter (where recommendation_basis = 'staff_review_required')::numeric as review_candidate_count
      from candidates
      where customer_key is not null
      group by customer_key
    ),
    ranked as (
      select distinct on (candidate.customer_key)
        candidate.*,
        counted.candidate_count,
        counted.mobile_candidate_count,
        counted.review_candidate_count
      from candidates candidate
      join counted on counted.customer_key = candidate.customer_key
      where candidate.customer_key is not null
      order by candidate.customer_key, candidate.score desc, candidate.created_at asc
    )
    insert into gp_customer_phone_recommendation (
      id,
      customer_key,
      medusa_customer_id,
      qbd_customer_list_id,
      legacy_customer_id,
      profile_id,
      customer_email_lower,
      phone_key,
      e164,
      line_type,
      sms_capable_candidate,
      recommendation_basis,
      candidate_count,
      mobile_candidate_count,
      review_candidate_count,
      evaluated_at,
      created_at,
      updated_at,
      deleted_at
    )
    select
      'gpphrec_' || md5(ranked.customer_key),
      ranked.customer_key,
      ranked.medusa_customer_id,
      ranked.qbd_customer_list_id,
      ranked.legacy_customer_id,
      ranked.profile_id,
      ranked.customer_email_lower,
      ranked.phone_key,
      ranked.e164,
      ranked.line_type,
      ranked.sms_capable_candidate,
      ranked.recommendation_basis,
      ranked.candidate_count,
      ranked.mobile_candidate_count,
      ranked.review_candidate_count,
      now(),
      now(),
      now(),
      null
    from ranked
    on conflict (customer_key) do update set
      medusa_customer_id = excluded.medusa_customer_id,
      qbd_customer_list_id = excluded.qbd_customer_list_id,
      legacy_customer_id = excluded.legacy_customer_id,
      profile_id = excluded.profile_id,
      customer_email_lower = excluded.customer_email_lower,
      phone_key = excluded.phone_key,
      e164 = excluded.e164,
      line_type = excluded.line_type,
      sms_capable_candidate = excluded.sms_capable_candidate,
      recommendation_basis = excluded.recommendation_basis,
      candidate_count = excluded.candidate_count,
      mobile_candidate_count = excluded.mobile_candidate_count,
      review_candidate_count = excluded.review_candidate_count,
      evaluated_at = excluded.evaluated_at,
      updated_at = excluded.updated_at,
      deleted_at = null
  `)
}
