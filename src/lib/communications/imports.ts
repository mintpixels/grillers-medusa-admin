import crypto from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { emitOpsAlert } from "../ops-alert"
import {
  recordCommunicationEvent,
  recordSuppression,
  upsertCustomerProfile,
} from "./core"

type KnexLike = any

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const now = () => new Date()

async function emitConstantContactImportFailedRowsAlert(input: {
  importRunId: string
  stats: Record<string, number>
  metadata: Record<string, any>
}) {
  try {
    await emitOpsAlert({
      alertKind: "constant_contact_import_failed_rows",
      severity: "warn",
      title: "Constant Contact import completed with row failures",
      path: "src/lib/communications/imports.ts",
      source: "medusa-server",
      fingerprint: "constant_contact_import:failed_rows",
      meta: {
        import_run_id: input.importRunId,
        total_count: input.stats.total,
        imported_count: input.stats.imported,
        skipped_count: input.stats.skipped,
        failed_count: input.stats.failed,
        subscribed_count: input.stats.subscribed,
        unsubscribed_count: input.stats.unsubscribed,
        bounced_count: input.stats.bounced,
        has_uploaded_by: Boolean(input.metadata.uploaded_by),
        has_filename: Boolean(input.metadata.filename),
      },
    })
  } catch {
    // Import completion must not be reversed by alert delivery failure.
  }
}

function field(row: Record<string, any>, names: string[]) {
  for (const name of names) {
    const value = row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()]
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim()
    }
  }
  return ""
}

function boolish(value: unknown) {
  return ["true", "yes", "y", "1", "subscribed", "active"].includes(
    String(value || "")
      .trim()
      .toLowerCase()
  )
}

function statusOf(row: Record<string, any>) {
  return field(row, ["status", "Email Status", "Permission Status", "permission_status"])
    .toLowerCase()
}

export async function importConstantContactRows(
  db: KnexLike,
  rows: Record<string, any>[],
  metadata: Record<string, any> = {}
) {
  const run = {
    id: id("gpimp"),
    source: "constant_contact",
    status: "running",
    started_at: now(),
    imported_count: 0,
    skipped_count: 0,
    failed_count: 0,
    stats: {},
    metadata,
    created_at: now(),
    updated_at: now(),
  }
  await db("gp_import_run").insert(run)

  const stats = {
    total: rows.length,
    subscribed: 0,
    unsubscribed: 0,
    bounced: 0,
    no_consent: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
  }

  for (const row of rows) {
    const email = field(row, ["email", "Email Address", "Email", "email_address"])
    if (!email) {
      stats.skipped += 1
      continue
    }

    try {
      const status = statusOf(row)
      const unsubscribed =
        status.includes("unsub") || boolish(field(row, ["unsubscribed"]))
      const bounced = status.includes("bounce") || boolish(field(row, ["bounced"]))
      // Consent requires POSITIVE evidence (Active/Confirmed/Subscribed).
      // CC exports also contain rows with an empty status, "Awaiting
      // confirmation", or "No Permissions Set" — those contacts never
      // opted in, and importing them as consented would make the first
      // GP campaign a CAN-SPAM violation against thousands of addresses.
      // They import with email_consent=false (transactional still fine)
      // and NO suppression record (they didn't unsubscribe).
      const consent =
        !unsubscribed &&
        !bounced &&
        (status.includes("active") ||
          status.includes("confirmed") ||
          status.includes("subscribed") ||
          boolish(field(row, ["subscribed"])))

      // no-consent rows pass undefined so an existing profile's stronger
      // evidence (e.g. site signup with express opt-in) is never
      // downgraded by a CC row that merely lacks permission data.
      const consentSignal = consent
        ? true
        : unsubscribed || bounced
          ? false
          : undefined

      const profile = await upsertCustomerProfile(db, {
        email,
        first_name: field(row, ["first_name", "First Name"]) || undefined,
        last_name: field(row, ["last_name", "Last Name"]) || undefined,
        email_consent: consentSignal,
        preferences:
          consentSignal === undefined
            ? undefined
            : {
                promotions: consentSignal,
                holiday_reminders: consentSignal,
                recipes: consentSignal,
                new_products: consentSignal,
                back_in_stock: consentSignal,
              },
        metadata: {
          constant_contact_contact_id: field(row, ["id", "Contact ID"]) || null,
          constant_contact_lists: field(row, ["lists", "Lists"]) || null,
          constant_contact_tags: field(row, ["tags", "Tags"]) || null,
          constant_contact_permission:
            field(row, ["permission", "Email permission status"]) || null,
          imported_from: "constant_contact",
        },
      })

      if (unsubscribed) {
        stats.unsubscribed += 1
        await recordSuppression(db, {
          email,
          scope: "marketing",
          reason: "constant_contact_unsubscribe",
          source: "constant_contact_import",
          metadata: row,
        })
      } else if (bounced) {
        stats.bounced += 1
        await recordSuppression(db, {
          email,
          scope: "hard_bounce",
          reason: "constant_contact_bounce",
          source: "constant_contact_import",
          metadata: row,
        })
      } else if (consent) {
        stats.subscribed += 1
      } else {
        stats.no_consent += 1
      }

      await recordCommunicationEvent(db, {
        event_name: "constant_contact_profile_imported",
        event_id: `constant_contact_import:${run.id}:${email.toLowerCase()}`,
        source: "constant_contact_import",
        profile_id: profile?.id || null,
        email,
        properties: {
          import_run_id: run.id,
          status,
          lists: field(row, ["lists", "Lists"]) || null,
          tags: field(row, ["tags", "Tags"]) || null,
        },
      })

      stats.imported += 1
    } catch (err) {
      stats.failed += 1
      await recordCommunicationEvent(db, {
        event_name: "constant_contact_profile_import_failed",
        source: "constant_contact_import",
        email,
        properties: {
          import_run_id: run.id,
          error: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }

  const status = stats.failed ? "completed_with_errors" : "completed"
  await db("gp_import_run").where("id", run.id).update({
    status,
    completed_at: now(),
    imported_count: stats.imported,
    skipped_count: stats.skipped,
    failed_count: stats.failed,
    stats,
    updated_at: now(),
  })

  if (stats.failed > 0) {
    await emitConstantContactImportFailedRowsAlert({
      importRunId: run.id,
      stats,
      metadata,
    })
  }

  return { import_run_id: run.id, status, stats }
}

export async function importConstantContactPayload(
  container: MedusaContainer,
  rows: Record<string, any>[],
  metadata: Record<string, any> = {}
) {
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  return importConstantContactRows(db, rows, metadata)
}
