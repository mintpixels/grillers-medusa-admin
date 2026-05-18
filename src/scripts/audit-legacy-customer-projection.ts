import mysql from "mysql2/promise"
import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  envVarsAreSet,
  getBooleanArg,
  getNumberArg,
  getStringArg,
  loadEnvFilesUntil,
  parseArgs,
} from "./lib/legacy-import-utils"

type CustomerProjectionRow = {
  legacy_customer_id: string
  medusa_customer_id: string | null
  medusa_auth_identity_id: string | null
  email_lower: string | null
  legacy_username: string | null
  auth_import_status: string | null
  address_import_status: string | null
  metadata: Record<string, unknown> | null
  customer_exists: boolean
  has_account: boolean
  auth_exists: boolean
  email_provider_exists: boolean
  email_provider_has_password: boolean
  username_provider_exists: boolean
  username_provider_has_password: boolean
  username_lower_provider_exists: boolean
  username_lower_provider_has_password: boolean
  address_count: string | number
  legacy_order_count: string | number
}

type GapSample = {
  kind: string
  legacyCustomerId?: string | null
  medusaCustomerId?: string | null
  authImportStatus?: string | null
  addressImportStatus?: string | null
  detail?: string
}

const AUTH_PROVIDER = "emailpass"

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function addSample(samples: GapSample[], sampleLimit: number, sample: GapSample) {
  if (samples.length < sampleLimit) {
    samples.push(sample)
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim()
}

function legacyFlagIsTruthy(value: unknown): boolean {
  return ["1", "true", "yes", "y", "active"].includes(
    String(value ?? "").trim().toLowerCase()
  )
}

function mapMetadataCanOrderOnline(row: CustomerProjectionRow): boolean {
  return legacyFlagIsTruthy(row.metadata?.can_order_online)
}

function usernameLoginKeys(row: CustomerProjectionRow) {
  const username = normalizeText(row.legacy_username)
  if (!username) {
    return { expectsExact: false, expectsLower: false }
  }

  const usernameLower = username.toLowerCase()
  const emailLower = normalizeText(row.email_lower).toLowerCase()

  return {
    expectsExact: username.toLowerCase() !== emailLower,
    expectsLower: username !== usernameLower && usernameLower !== emailLower,
  }
}

function legacyUsernameFallbackCanCover(row: CustomerProjectionRow) {
  return Boolean(
    normalizeText(row.legacy_username) &&
      row.medusa_customer_id &&
      row.customer_exists &&
      row.has_account &&
      row.medusa_auth_identity_id &&
      row.auth_exists &&
      row.email_provider_has_password
  )
}

function legacyEnvIsAvailable() {
  return envVarsAreSet([
    "LEGACY_DB_HOST",
    "LEGACY_DB_NAME",
    "LEGACY_DB_USER",
    "LEGACY_DB_PASSWORD",
  ])
}

function rawAddressExpression() {
  const fields = [
    "BADDR1",
    "BADDR2",
    "BADDR3",
    "BADDR4",
    "SADDR1",
    "SADDR2",
    "SADDR3",
    "SADDR4",
  ]

  return fields
    .map((field) => `NULLIF(TRIM(${field}), '') IS NOT NULL`)
    .join(" OR ")
}

async function loadLegacySourceFacts({
  enabled,
  envFile,
}: {
  enabled: boolean
  envFile?: string
}) {
  if (!enabled) {
    return {
      available: false,
      reason: "disabled",
      idsWithPassword: new Set<string>(),
      idsCanOrderOnline: new Set<string>(),
      idsWithRawAddress: new Set<string>(),
      totals: null,
    }
  }

  const loadedEnvFiles = loadEnvFilesUntil([
    envFile,
    process.env.LEGACY_ENV_FILE,
    process.env.ENV_FILE,
    ".env.legacy",
    ".env.local",
    ".env",
    "../grillerspride/.env.legacy",
    "../grillerspride/.env",
  ], legacyEnvIsAvailable)

  if (!legacyEnvIsAvailable()) {
    return {
      available: false,
      reason: "missing_legacy_db_env",
      loadedEnvFile: loadedEnvFiles[0] ?? null,
      loadedEnvFiles,
      idsWithPassword: new Set<string>(),
      idsCanOrderOnline: new Set<string>(),
      idsWithRawAddress: new Set<string>(),
      totals: null,
    }
  }

  const connection = await mysql.createConnection({
    host: process.env.LEGACY_DB_HOST,
    port: Number(process.env.LEGACY_DB_PORT || 3306),
    database: process.env.LEGACY_DB_NAME,
    user: process.env.LEGACY_DB_USER,
    password: process.env.LEGACY_DB_PASSWORD,
    ssl: ["1", "true", "yes", "y"].includes(
      String(process.env.LEGACY_DB_SSL ?? "").trim().toLowerCase()
    )
      ? {}
      : undefined,
  })

  try {
    const [rows] = await connection.execute<any[]>(`
      select
        ID,
        case when NULLIF(TRIM(PASSWORD), '') is not null then 1 else 0 end as has_password,
        case when lower(trim(coalesce(CANORDERONLINE, ''))) in ('1', 'true', 'yes', 'y', 'active') then 1 else 0 end as can_order_online,
        case when ${rawAddressExpression()} then 1 else 0 end as has_raw_address
      from CUSTOMERS
      where NULLIF(TRIM(EMAIL), '') is not null
    `)

    const idsWithPassword = new Set<string>()
    const idsCanOrderOnline = new Set<string>()
    const idsWithRawAddress = new Set<string>()

    for (const row of rows) {
      const id = String(row.ID)
      if (Number(row.has_password) > 0) {
        idsWithPassword.add(id)
      }
      if (Number(row.can_order_online) > 0) {
        idsCanOrderOnline.add(id)
      }
      if (Number(row.has_raw_address) > 0) {
        idsWithRawAddress.add(id)
      }
    }

    return {
      available: true,
      reason: null,
      loadedEnvFile: loadedEnvFiles[0] ?? null,
      loadedEnvFiles,
      idsWithPassword,
      idsCanOrderOnline,
      idsWithRawAddress,
      totals: {
        customersWithEmail: rows.length,
        withPassword: idsWithPassword.size,
        canOrderOnline: idsCanOrderOnline.size,
        withRawAddress: idsWithRawAddress.size,
      },
    }
  } finally {
    await connection.end()
  }
}

async function getCustomerProjectionRows(db: any): Promise<CustomerProjectionRow[]> {
  return db.raw(`
    with maps as (
      select *
      from legacy_customer_map
      where deleted_at is null
    ),
    provider_keys as (
      select
        auth_identity_id,
        entity_id,
        bool_or(provider_metadata->>'password' is not null) as has_password
      from provider_identity
      where provider = ?
        and deleted_at is null
      group by auth_identity_id, entity_id
    ),
    address_counts as (
      select customer_id, count(*) as address_count
      from customer_address
      where deleted_at is null
      group by customer_id
    ),
    legacy_order_counts as (
      select medusa_customer_id, count(*) as legacy_order_count
      from legacy_order
      where deleted_at is null
        and medusa_customer_id is not null
      group by medusa_customer_id
    )
    select
      m.legacy_customer_id,
      m.medusa_customer_id,
      m.medusa_auth_identity_id,
      m.email_lower,
      m.legacy_username,
      m.auth_import_status,
      m.address_import_status,
      m.metadata,
      (c.id is not null) as customer_exists,
      coalesce(c.has_account, false) as has_account,
      (ai.id is not null) as auth_exists,
      (email_provider.auth_identity_id is not null) as email_provider_exists,
      coalesce(email_provider.has_password, false) as email_provider_has_password,
      (username_provider.auth_identity_id is not null) as username_provider_exists,
      coalesce(username_provider.has_password, false) as username_provider_has_password,
      (username_lower_provider.auth_identity_id is not null) as username_lower_provider_exists,
      coalesce(username_lower_provider.has_password, false) as username_lower_provider_has_password,
      coalesce(address_counts.address_count, 0) as address_count,
      coalesce(legacy_order_counts.legacy_order_count, 0) as legacy_order_count
    from maps m
    left join customer c on c.id = m.medusa_customer_id and c.deleted_at is null
    left join auth_identity ai on ai.id = m.medusa_auth_identity_id and ai.deleted_at is null
    left join provider_keys email_provider
      on email_provider.auth_identity_id = m.medusa_auth_identity_id
      and email_provider.entity_id = m.email_lower
    left join provider_keys username_provider
      on username_provider.auth_identity_id = m.medusa_auth_identity_id
      and username_provider.entity_id = m.legacy_username
    left join provider_keys username_lower_provider
      on username_lower_provider.auth_identity_id = m.medusa_auth_identity_id
      and username_lower_provider.entity_id = lower(m.legacy_username)
    left join address_counts on address_counts.customer_id = m.medusa_customer_id
    left join legacy_order_counts on legacy_order_counts.medusa_customer_id = m.medusa_customer_id
    order by m.legacy_customer_id::numeric nulls last, m.legacy_customer_id
  `, [AUTH_PROVIDER]).then((result: any) => result.rows ?? result)
}

async function getLegacyOrderProjectionStats(db: any) {
  const [stats] = await db.raw(`
    select
      (select count(*) from legacy_order where deleted_at is null) as legacy_orders_total,
      (select count(*) from legacy_order where deleted_at is null and medusa_customer_id is not null) as legacy_orders_with_medusa_customer,
      (
        select count(distinct lo.id)
        from legacy_order lo
        join legacy_customer_map m on m.deleted_at is null
          and (
            (lo.qbd_customer_list_id is not null and lo.qbd_customer_list_id = m.qbd_customer_list_id)
            or (lo.legacy_customer_id is not null and lo.legacy_customer_id = m.legacy_customer_id)
            or (lo.email_lower is not null and lo.email_lower = m.email_lower)
          )
        where lo.deleted_at is null
          and lo.medusa_customer_id is null
          and m.medusa_customer_id is not null
      ) as legacy_orders_unlinked_but_mappable,
      (
        select count(*)
        from legacy_order lo
        left join customer c on c.id = lo.medusa_customer_id and c.deleted_at is null
        where lo.deleted_at is null
          and lo.medusa_customer_id is not null
          and c.id is null
      ) as legacy_orders_with_missing_customer,
      (select count(*) from legacy_order_line where deleted_at is null) as legacy_lines_total,
      (select count(*) from legacy_order_line where deleted_at is null and mapping_status = 'mapped') as mapped_product_lines,
      (select count(*) from legacy_order_line where deleted_at is null and mapping_status = 'unmapped') as unmapped_product_lines,
      (select count(*) from legacy_order_line where deleted_at is null and mapping_status = 'staff_assisted') as staff_assisted_product_lines,
      (select count(*) from legacy_order_line where deleted_at is null and mapping_status = 'non_product') as non_product_lines,
      (
        select count(*)
        from product
        where deleted_at is null
          and metadata->>'legacy_reorder_only' = 'true'
      ) as legacy_reorder_only_products,
      (
        select count(*)
        from product_variant
        where deleted_at is null
          and metadata->>'legacy_reorder_only' = 'true'
      ) as legacy_reorder_only_variants,
      (
        select count(*)
        from legacy_item_map
        where deleted_at is null
          and metadata->>'legacy_reorder_only' = 'true'
      ) as legacy_reorder_only_item_maps,
      (
        select count(*)
        from legacy_order_line
        where deleted_at is null
          and metadata->>'mapping_source' = 'legacy_reorder_only_product'
      ) as legacy_reorder_only_lines,
      (
        select count(*)
        from legacy_order_line
        where deleted_at is null
          and coalesce(mapping_status, '') not in ('mapped', 'unmapped', 'staff_assisted', 'non_product')
      ) as other_line_statuses
  `).then((result: any) => result.rows ?? result)

  return {
    legacyOrdersTotal: toNumber(stats.legacy_orders_total),
    legacyOrdersWithMedusaCustomer: toNumber(
      stats.legacy_orders_with_medusa_customer
    ),
    legacyOrdersUnlinkedButMappable: toNumber(
      stats.legacy_orders_unlinked_but_mappable
    ),
    legacyOrdersWithMissingCustomer: toNumber(
      stats.legacy_orders_with_missing_customer
    ),
    legacyLinesTotal: toNumber(stats.legacy_lines_total),
    mappedProductLines: toNumber(stats.mapped_product_lines),
    unmappedProductLines: toNumber(stats.unmapped_product_lines),
    staffAssistedProductLines: toNumber(stats.staff_assisted_product_lines),
    nonProductLines: toNumber(stats.non_product_lines),
    legacyReorderOnlyProducts: toNumber(stats.legacy_reorder_only_products),
    legacyReorderOnlyVariants: toNumber(stats.legacy_reorder_only_variants),
    legacyReorderOnlyItemMaps: toNumber(stats.legacy_reorder_only_item_maps),
    legacyReorderOnlyLines: toNumber(stats.legacy_reorder_only_lines),
    otherLineStatuses: toNumber(stats.other_line_statuses),
  }
}

export default async function auditLegacyCustomerProjection({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const args = parseArgs()
  const sampleLimit = Math.max(0, getNumberArg(args, ["sample-limit"], 20))
  const failOnGaps = getBooleanArg(args, ["fail-on-gaps"], false)
  const strictLaunch = getBooleanArg(args, ["strict-launch"], false)
  const checkLegacySource = getBooleanArg(args, ["check-legacy-source"], true)
  const envFile = getStringArg(args, ["legacy-env-file", "env-file"])

  const [rows, orderStats, legacySource] = await Promise.all([
    getCustomerProjectionRows(db),
    getLegacyOrderProjectionStats(db),
    loadLegacySourceFacts({ enabled: checkLegacySource, envFile }),
  ])

  const samples: GapSample[] = []
  const hardGapCounts: Record<string, number> = {}
  const compromiseCounts: Record<string, number> = {}

  const bump = (
    target: Record<string, number>,
    kind: string,
    row?: CustomerProjectionRow,
    detail?: string
  ) => {
    target[kind] = (target[kind] ?? 0) + 1
    if (row) {
      addSample(samples, sampleLimit, {
        kind,
        legacyCustomerId: row.legacy_customer_id,
        medusaCustomerId: row.medusa_customer_id,
        authImportStatus: row.auth_import_status,
        addressImportStatus: row.address_import_status,
        detail,
      })
    }
  }

  let withCustomerId = 0
  let customerExists = 0
  let customersWithAccount = 0
  let withAuthId = 0
  let authExists = 0
  let emailProviderHasPassword = 0
  let usernameAliasExpected = 0
  let usernameAliasPresent = 0
  let usernameAliasFallbackSupported = 0
  let usernameLowerAliasExpected = 0
  let usernameLowerAliasPresent = 0
  let usernameLowerAliasFallbackSupported = 0
  let customersWithAddress = 0
  let customersWithLegacyOrders = 0
  let expectedPasswordAccounts = 0
  let sourceNoPasswordAccounts = 0
  let sourceNoPasswordNoOnlineAccounts = 0
  let resetReadyNoPasswordAccounts = 0
  let expectedAddressAccounts = 0
  let expectedAddressAccountsWithAddress = 0

  for (const row of rows) {
    const addressCount = toNumber(row.address_count)
    const legacyOrderCount = toNumber(row.legacy_order_count)
    const sourceExpectsPassword = legacySource.available
      ? legacySource.idsWithPassword.has(row.legacy_customer_id)
      : row.auth_import_status !== "no_password"
    const sourceCanOrderOnline = legacySource.available
      ? legacySource.idsCanOrderOnline.has(row.legacy_customer_id)
      : mapMetadataCanOrderOnline(row)
    const sourceExpectsAddress = legacySource.available
      ? legacySource.idsWithRawAddress.has(row.legacy_customer_id)
      : false

    if (row.medusa_customer_id) {
      withCustomerId += 1
    }
    if (row.customer_exists) {
      customerExists += 1
    }
    if (row.has_account) {
      customersWithAccount += 1
    }
    if (row.medusa_auth_identity_id) {
      withAuthId += 1
    }
    if (row.auth_exists) {
      authExists += 1
    }
    if (row.email_provider_has_password) {
      emailProviderHasPassword += 1
    }
    if (addressCount > 0) {
      customersWithAddress += 1
    }
    if (legacyOrderCount > 0) {
      customersWithLegacyOrders += 1
    }

    if (!row.medusa_customer_id || !row.customer_exists) {
      bump(hardGapCounts, "missing_customer", row)
    } else if (!row.has_account) {
      bump(hardGapCounts, "customer_without_account", row)
    }

    if (sourceExpectsPassword) {
      expectedPasswordAccounts += 1

      if (!row.medusa_auth_identity_id || !row.auth_exists) {
        bump(hardGapCounts, "expected_auth_missing", row)
      } else if (!row.email_provider_has_password) {
        bump(hardGapCounts, "expected_email_login_password_missing", row)
      }

      const loginKeys = usernameLoginKeys(row)
      const isAliasConflict =
        row.auth_import_status === "imported_with_alias_conflicts"
      const fallbackCanCover = legacyUsernameFallbackCanCover(row)

      if (loginKeys.expectsExact) {
        usernameAliasExpected += 1
        if (row.username_provider_has_password) {
          usernameAliasPresent += 1
        } else if (isAliasConflict && fallbackCanCover) {
          usernameAliasFallbackSupported += 1
        } else if (isAliasConflict) {
          bump(compromiseCounts, "username_alias_conflict", row)
        } else {
          bump(hardGapCounts, "expected_username_login_missing", row)
        }
      }

      if (loginKeys.expectsLower) {
        usernameLowerAliasExpected += 1
        if (row.username_lower_provider_has_password) {
          usernameLowerAliasPresent += 1
        } else if (isAliasConflict && fallbackCanCover) {
          usernameLowerAliasFallbackSupported += 1
        } else if (isAliasConflict) {
          bump(compromiseCounts, "username_lower_alias_conflict", row)
        } else {
          bump(hardGapCounts, "expected_username_lower_login_missing", row)
        }
      }
    } else {
      sourceNoPasswordAccounts += 1
      if (!sourceCanOrderOnline) {
        sourceNoPasswordNoOnlineAccounts += 1
      }

      if (
        row.medusa_auth_identity_id &&
        row.auth_exists &&
        row.email_provider_exists
      ) {
        resetReadyNoPasswordAccounts += 1
      } else {
        bump(hardGapCounts, "reset_ready_no_password_auth_missing", row)
      }

      if (sourceCanOrderOnline) {
        bump(compromiseCounts, "online_legacy_customer_without_password", row)
      }
    }

    if (sourceExpectsAddress) {
      expectedAddressAccounts += 1
      if (addressCount > 0) {
        expectedAddressAccountsWithAddress += 1
      } else {
        bump(hardGapCounts, "source_address_missing_in_medusa", row)
      }
    }
  }

  if (orderStats.legacyOrdersUnlinkedButMappable > 0) {
    hardGapCounts.legacy_orders_unlinked_but_mappable =
      orderStats.legacyOrdersUnlinkedButMappable
    addSample(samples, sampleLimit, {
      kind: "legacy_orders_unlinked_but_mappable",
      detail: "Some QuickBooks orders match a legacy customer map but do not have medusa_customer_id.",
    })
  }

  if (orderStats.legacyOrdersWithMissingCustomer > 0) {
    hardGapCounts.legacy_order_customer_missing =
      orderStats.legacyOrdersWithMissingCustomer
    addSample(samples, sampleLimit, {
      kind: "legacy_order_customer_missing",
      detail: "Some QuickBooks orders point at a deleted or missing Medusa customer.",
    })
  }

  if (orderStats.otherLineStatuses > 0) {
    hardGapCounts.legacy_order_lines_with_unknown_status =
      orderStats.otherLineStatuses
  }

  if (orderStats.unmappedProductLines > 0) {
    compromiseCounts.unmapped_product_lines = orderStats.unmappedProductLines
  }

  const hardGaps = Object.values(hardGapCounts).reduce(
    (sum, count) => sum + count,
    0
  )
  const launchCompromises = Object.values(compromiseCounts).reduce(
    (sum, count) => sum + count,
    0
  )

  const report = {
    customers: {
      legacyMaps: rows.length,
      withCustomerId,
      customerExists,
      customersWithAccount,
      customersWithAddress,
      customersWithLegacyOrders,
    },
    auth: {
      expectedPasswordAccounts,
      sourceNoPasswordAccounts,
      sourceNoPasswordNoOnlineAccounts,
      resetReadyNoPasswordAccounts,
      withAuthId,
      authExists,
      emailProviderHasPassword,
      usernameAliasExpected,
      usernameAliasPresent,
      usernameAliasFallbackSupported,
      usernameAliasCovered:
        usernameAliasPresent + usernameAliasFallbackSupported,
      usernameLowerAliasExpected,
      usernameLowerAliasPresent,
      usernameLowerAliasFallbackSupported,
      usernameLowerAliasCovered:
        usernameLowerAliasPresent + usernameLowerAliasFallbackSupported,
    },
    addresses: {
      legacySourceChecked: checkLegacySource,
      legacySourceAvailable: legacySource.available,
      legacySourceReason: legacySource.reason,
      legacySourceTotals: legacySource.totals,
      expectedAddressAccounts: legacySource.available
        ? expectedAddressAccounts
        : null,
      expectedAddressAccountsWithAddress: legacySource.available
        ? expectedAddressAccountsWithAddress
        : null,
    },
    quickbooksProjection: orderStats,
    hardGapCounts,
    compromiseCounts,
    hardGaps,
    launchCompromises,
    samples,
  }

  logger.info(`[legacy-customer-projection-audit] ${JSON.stringify(report)}`)

  const shouldFail =
    (failOnGaps && hardGaps > 0) ||
    (strictLaunch && (hardGaps > 0 || launchCompromises > 0))

  if (shouldFail) {
    throw new Error(
      `Legacy customer projection audit failed: hardGaps=${hardGaps}, launchCompromises=${launchCompromises}`
    )
  }
}
