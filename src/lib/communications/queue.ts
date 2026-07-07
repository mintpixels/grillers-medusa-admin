import crypto from "crypto"
import type { Logger, MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Queue, Worker, type Job } from "bullmq"
import IORedis from "ioredis"
import { emitOpsAlert } from "../ops-alert"

type KnexLike = any

const QUEUE_PREFIX = process.env.COMMUNICATIONS_QUEUE_PREFIX || "gp-communications"
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

function redisUrl() {
  return process.env.REDIS_URL || process.env.COMMUNICATIONS_REDIS_URL || ""
}

function redisConnection() {
  const url = redisUrl()
  if (!url) return null
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}

export function queuesConfigured() {
  return Boolean(redisUrl())
}

function queue(name: string) {
  const connection = redisConnection()
  if (!connection) return null
  return new Queue(`${QUEUE_PREFIX}-${name}`, {
    connection: connection as any,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 60_000 },
      removeOnComplete: 5000,
      removeOnFail: 5000,
    },
  })
}

function redactedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "")
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 500)
}

export async function emitCommunicationWorkerJobFailedAlert({
  workerName,
  job,
  error,
  logger,
}: {
  workerName: string
  job?: Pick<Job, "id" | "name" | "attemptsMade" | "opts" | "data"> | null
  error: unknown
  logger?: Pick<Logger, "warn" | "error">
}) {
  const data =
    job?.data && typeof job.data === "object" && !Array.isArray(job.data)
      ? (job.data as Record<string, any>)
      : {}

  return emitOpsAlert({
    alertKind: "communications_worker_job_failed",
    severity: "warn",
    title: `Communications worker ${workerName} job ${job?.id || "unknown"} failed`,
    path: "src/lib/communications/queue.ts:startCommunicationWorkers",
    source: "medusa-server",
    logger,
    meta: {
      worker_name: workerName,
      job_id: job?.id || null,
      job_name: job?.name || null,
      attempts_made: job?.attemptsMade ?? null,
      max_attempts: job?.opts?.attempts ?? null,
      event_id: data.event_id || null,
      event_name: data.event_name || null,
      order_id: data.order_id || null,
      cart_id: data.cart_id || null,
      campaign_id: data.campaign_id || null,
      flow_id: data.flow_id || null,
      message_id: data.message_id || null,
      template_key: data.template_key || null,
      has_profile_id: Boolean(data.profile_id),
      has_medusa_customer_id: Boolean(data.medusa_customer_id),
      error: redactedErrorMessage(error),
    },
  })
}

async function delivery(
  db: KnexLike,
  event: Record<string, any>,
  status: "delivered" | "failed" | "skipped",
  metadata: Record<string, any> = {},
  error?: string
) {
  const now = new Date()
  try {
    await db("gp_event_delivery")
      .insert({
        id: id("gpedlv"),
        event_id: event.event_id,
        event_name: event.event_name,
        target: "bullmq",
        status,
        attempts: 1,
        last_attempt_at: now,
        delivered_at: status === "delivered" ? now : null,
        error_message: error || null,
        metadata,
        created_at: now,
        updated_at: now,
      })
      .onConflict(db.raw('("event_id", "target") where "deleted_at" is null'))
      .merge({
        status,
        attempts: db.raw("gp_event_delivery.attempts + 1"),
        last_attempt_at: now,
        delivered_at: status === "delivered" ? now : null,
        error_message: error || null,
        metadata,
        updated_at: now,
      })
  } catch {
    // Queue delivery bookkeeping is non-critical.
  }
}

export async function enqueueCommunicationEvent(
  db: KnexLike,
  event: Record<string, any>
) {
  const eventQueue = queue("events")
  if (!eventQueue) {
    await delivery(db, event, "skipped", { reason: "redis_not_configured" })
    return false
  }
  try {
    await eventQueue.add("communication-event", event, {
      jobId: event.event_id,
    })
    await delivery(db, event, "delivered", { queue: eventQueue.name })
    await eventQueue.close()
    return true
  } catch (err) {
    await delivery(
      db,
      event,
      "failed",
      {},
      err instanceof Error ? err.message : String(err)
    )
    await eventQueue.close().catch(() => undefined)
    return false
  }
}

export async function enqueueFlowRun(input: Record<string, any> = {}) {
  const flowQueue = queue("flows")
  if (!flowQueue) return false
  await flowQueue.add("flow-run", input, {
    jobId: input.job_id || `flow-run:${Date.now()}`,
    delay: Number(input.delay_ms || 0),
  })
  await flowQueue.close()
  return true
}

export async function enqueueCampaignSend(
  campaignId: string,
  input: Record<string, any> = {}
) {
  const campaignQueue = queue("campaigns")
  if (!campaignQueue) return false
  await campaignQueue.add(
    "campaign-send",
    { campaign_id: campaignId, ...input },
    {
      // input.job_id lets blackout-resume jobs use a distinct id — BullMQ
      // dedupes by jobId, so re-adding `campaign:<id>` after a completed
      // (deferred) run would silently no-op and strand the campaign.
      jobId:
        input.job_id ||
        (input.test_email
          ? `campaign-test:${campaignId}:${input.test_email}:${Date.now()}`
          : `campaign:${campaignId}`),
      delay: Number(input.delay_ms || 0),
    }
  )
  await campaignQueue.close()
  return true
}

async function processEventJob(container: MedusaContainer, job: Job) {
  const event = job.data || {}
  const { evaluateFlowsForEvent } = await import("./flows.js")
  const { syncCartLifecycleFromEvent } = await import("./cart-lifecycle.js")
  const { attributeOrderFromEvent } = await import("./attribution.js")
  const db = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  await syncCartLifecycleFromEvent(db, event)
  await attributeOrderFromEvent(db, event)
  if (!String(event.event_name || "").startsWith("email_")) {
    await evaluateFlowsForEvent(db, event)
  }
}

async function processFlowJob(container: MedusaContainer) {
  const { runDueFlowEnrollments } = await import("./flows.js")
  return runDueFlowEnrollments(container, 100)
}

async function processCampaignJob(container: MedusaContainer, job: Job) {
  const { sendCampaign } = await import("./admin.js")
  const result: any = await sendCampaign(
    container,
    job.data.campaign_id,
    job.data || {}
  )
  // Shabbat/Yom Tov deferral: re-enqueue the same campaign for after
  // havdalah under a fresh job id. Idempotency keys make the resumed run
  // skip anything already sent.
  if (result?.deferred && result?.resume_at) {
    const delayMs = Math.max(
      60_000,
      new Date(result.resume_at).getTime() - Date.now()
    )
    await enqueueCampaignSend(job.data.campaign_id, {
      ...(job.data || {}),
      job_id: `campaign:${job.data.campaign_id}:resume:${Date.now()}`,
      delay_ms: delayMs,
    })
  }
  return result
}

let inprocWorkers: any[] | null = null

/**
 * Idempotent in-process worker bootstrap. Nothing on Railway runs the
 * dedicated communications:worker script, so without this the BullMQ
 * queues fill and never drain (observed: 2,415 waiting event jobs,
 * 0 active). Called from a scheduled job every minute; starts once per
 * process. Set COMMUNICATIONS_INPROC_WORKERS=false when a dedicated
 * worker service exists.
 */
export function ensureCommunicationWorkers(container: MedusaContainer) {
  if (process.env.COMMUNICATIONS_INPROC_WORKERS === "false") {
    return { started: false, reason: "disabled" }
  }
  if (inprocWorkers) {
    return { started: false, reason: "already_running", count: inprocWorkers.length }
  }
  const workers = startCommunicationWorkers(container)
  if (!workers.length) {
    return { started: false, reason: "no_redis" }
  }
  inprocWorkers = workers
  return { started: true, count: workers.length }
}

export function startCommunicationWorkers(container: MedusaContainer) {
  const connection = redisConnection()
  if (!connection) return []
  const logger = container.resolve("logger")

  const workers = [
    new Worker(
      `${QUEUE_PREFIX}-events`,
      (job) => processEventJob(container, job),
      { connection: connection as any, concurrency: Number(process.env.COMMUNICATIONS_EVENT_WORKERS || 4) }
    ),
    new Worker(
      `${QUEUE_PREFIX}-flows`,
      () => processFlowJob(container),
      { connection: connection as any, concurrency: 1 }
    ),
    new Worker(
      `${QUEUE_PREFIX}-campaigns`,
      (job) => processCampaignJob(container, job),
      { connection: connection as any, concurrency: Number(process.env.COMMUNICATIONS_CAMPAIGN_WORKERS || 1) }
    ),
  ]

  for (const worker of workers) {
    worker.on("failed", (job, err) => {
      logger.error(
        `[communications-worker] ${worker.name} job=${job?.id} failed: ${err.message}`
      )
      void emitCommunicationWorkerJobFailedAlert({
        workerName: worker.name,
        job,
        error: err,
        logger,
      }).catch(() => {
        // Alerting must never interfere with BullMQ retry/failure handling.
      })
    })
  }

  return workers
}

export async function communicationQueueHealth() {
  if (!queuesConfigured()) {
    return { configured: false, queues: [] }
  }
  const names = ["events", "flows", "campaigns"]
  const rows: Array<{ name: string; counts: Record<string, number> }> = []
  for (const name of names) {
    const q = queue(name)
    if (!q) continue
    const counts = await q.getJobCounts("waiting", "delayed", "active", "failed")
    rows.push({ name: q.name, counts })
    await q.close()
  }
  return { configured: true, queues: rows }
}
