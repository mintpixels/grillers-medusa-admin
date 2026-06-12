const host = process.env.JITSU_HOST?.replace(/\/+$/, "")
const secret = process.env.JITSU_SERVER_SECRET

if (!host || !secret) {
  console.warn("ops.ci skipped: JITSU_HOST/JITSU_SERVER_SECRET missing")
  process.exit(0)
}

const repo = process.env.GITHUB_REPOSITORY || "mintpixels/grillers-medusa-admin"
const startedAtMs = Number(process.env.CI_STARTED_AT_MS || 0)
const durationMs = startedAtMs ? Date.now() - startedAtMs : null
const runUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null
const branch = process.env.GITHUB_REF_NAME || "unknown"
const conclusion = process.env.CI_CONCLUSION || "unknown"

const payload = {
  event_type: "ops.ci",
  eventn_ctx: {
    event_id: process.env.GITHUB_RUN_ID || crypto.randomUUID(),
    event_timestamp_ms: Date.now(),
    ts: new Date().toISOString(),
    source: "ci:grillers-medusa-admin",
    title: `CI completed: ${conclusion} on ${branch}`,
    url: runUrl,
    meta: {
      repo,
      workflow: process.env.GITHUB_WORKFLOW || "ci",
      conclusion,
      branch,
      sha: process.env.GITHUB_SHA || "unknown",
      duration_ms: durationMs,
      url: runUrl,
    },
    ops_namespace: "ops_timeline",
  },
}

try {
  const response = await fetch(`${host}/api/v1/s2s/event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Auth-Token": secret,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    console.warn(`ops.ci emit failed: ${response.status} ${response.statusText}`)
  }
} catch (error) {
  console.warn("ops.ci emit failed:", error)
}
