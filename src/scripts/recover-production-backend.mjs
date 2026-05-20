#!/usr/bin/env node

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

const DEFAULT_BACKEND_URL =
  "https://grillers-medusa-admin-production.up.railway.app"

function argValue(name) {
  const equalsPrefix = `--${name}=`
  const equalsArg = process.argv.find((arg) => arg.startsWith(equalsPrefix))
  if (equalsArg) return equalsArg.slice(equalsPrefix.length)

  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function readDotEnv(file = ".env") {
  if (!fs.existsSync(file)) return {}

  const env = {}
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!match) continue

    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[match[1]] = value
  }
  return env
}

function normalizeUrl(url) {
  return (url || "").replace(/\/+$/, "")
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    })
    child.on("close", (code) => resolve(code === 0))
  })
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ")
  console.log(`\n$ ${label}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${label} exited with code ${code}`))
    })
  })
}

function runCapture(command, args, options = {}) {
  const label = [command, ...args].join(" ")
  console.log(`\n$ ${label}`)

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }
      const detail = stderr.trim() || stdout.trim()
      reject(
        new Error(
          `${label} exited with code ${code}${detail ? `: ${detail}` : ""}`
        )
      )
    })
  })
}

async function railwayReady() {
  try {
    await run("railway", ["status"])
    return true
  } catch (error) {
    console.error(`Railway is not ready: ${error.message}`)
    return false
  }
}

async function waitForRailway(attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\nRailway readiness check ${attempt}/${attempts}`)
    if (await railwayReady()) return true
    if (attempt < attempts) await sleep(delayMs)
  }
  return false
}

async function backendHealthy(backendUrl) {
  try {
    const startedAt = Date.now()
    const response = await fetch(`${backendUrl}/health`, {
      headers: { accept: "text/plain,application/json" },
      signal: AbortSignal.timeout(15_000),
    })
    const body = await response.text()
    const elapsed = Date.now() - startedAt

    if (response.ok && body.trim() === "OK") {
      console.log(`Backend health check passed in ${elapsed}ms`)
      return true
    }

    console.error(
      `Backend not healthy yet: HTTP ${response.status} in ${elapsed}ms. Body: ${body
        .replace(/\s+/g, " ")
        .slice(0, 200)}`
    )
    return false
  } catch (error) {
    console.error(`Backend health check failed: ${error.message}`)
    return false
  }
}

async function waitForBackend(backendUrl, attempts, delayMs) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    console.log(`\nBackend health check ${attempt}/${attempts}: ${backendUrl}`)
    if (await backendHealthy(backendUrl)) return true
    if (attempt < attempts) await sleep(delayMs)
  }
  return false
}

async function currentGitSha() {
  return (await runCapture("git", ["rev-parse", "HEAD"])).trim()
}

async function verifyGithubDeployment(repo, expectedSha, environmentFilter) {
  const output = await runCapture("gh", [
    "api",
    `repos/${repo}/deployments`,
    "--paginate",
    "--jq",
    ".[] | {sha, environment, created_at, updated_at, description} | @json",
  ])
  const deployments = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const latest = deployments.find((deployment) =>
    String(deployment.environment || "").includes(environmentFilter)
  )

  if (!latest) {
    throw new Error(
      `No GitHub deployment found for ${repo} environment containing ${JSON.stringify(
        environmentFilter
      )}`
    )
  }

  if (latest.sha !== expectedSha) {
    throw new Error(
      `Latest GitHub deployment for ${environmentFilter} is ${latest.sha.slice(
        0,
        7
      )}, expected ${expectedSha.slice(0, 7)}`
    )
  }

  console.log(
    `GitHub deployment matches expected commit (${expectedSha.slice(0, 7)})`
  )
}

async function maybeVerifyGithubDeployment() {
  if (!requireGithubDeployment) return

  if (!(await commandExists("gh"))) {
    throw new Error("gh is required when --require-github-deployment is set")
  }

  const expectedSha = argValue("commit") || (await currentGitSha())
  await verifyGithubDeployment(
    githubRepo,
    expectedSha,
    githubDeploymentEnvironment
  )
}

const dotEnv = readDotEnv()
const attempts = Number(argValue("attempts") || (hasFlag("wait") ? 30 : 1))
const delayMs = Number(argValue("delay-ms") || 60_000)
const backendUrl = normalizeUrl(
  argValue("backend-url") ||
    process.env.MEDUSA_BACKEND_URL ||
    dotEnv.MEDUSA_BACKEND_URL ||
    DEFAULT_BACKEND_URL
)
const backendAttempts = Number(argValue("backend-attempts") || 60)
const backendDelayMs = Number(argValue("backend-delay-ms") || 10_000)
const frontendDir = path.resolve(
  argValue("frontend-dir") ||
    process.env.FRONTEND_DIR ||
    path.join(process.cwd(), "..", "grillers-medusa-frontend")
)
const skipDeploy = hasFlag("skip-deploy")
const skipFrontend = hasFlag("skip-frontend")
const skipBackendWait = hasFlag("skip-backend-wait")
const requireGithubDeployment = hasFlag("require-github-deployment")
const githubRepo = argValue("github-repo") || "mintpixels/grillers-medusa-admin"
const githubDeploymentEnvironment =
  argValue("github-deployment-environment") || "grillers / production"

if (hasFlag("help")) {
  console.log(`Usage:
  yarn recover:production-backend [options]

Options:
  --wait                  Poll Railway up to 30 times before giving up.
  --attempts <n>          Number of Railway readiness attempts. Default: 1.
  --delay-ms <ms>         Delay between readiness attempts. Default: 60000.
  --backend-url <url>     Backend URL to smoke check. Default: MEDUSA_BACKEND_URL.
  --backend-attempts <n>  Backend health attempts after deploy. Default: 60.
  --backend-delay-ms <ms> Delay between backend health attempts. Default: 10000.
  --skip-deploy           Do not run railway up; only run smoke checks.
  --skip-backend-wait     Do not wait for backend /health before smoke checks.
  --skip-frontend         Do not run the storefront/backend smoke check.
  --frontend-dir <path>   Frontend repo path. Default: ../grillers-medusa-frontend.
  --require-github-deployment
                          Verify latest GitHub deployment matches this commit.
  --github-repo <owner/repo>
                          GitHub repo to inspect. Default: mintpixels/grillers-medusa-admin.
  --github-deployment-environment <text>
                          Deployment environment substring. Default: grillers / production.
  --commit <sha>          Expected deployment commit. Default: current git HEAD.

Required external tools:
  railway, unless --skip-deploy is set
  yarn
  gh, when --require-github-deployment is set
`)
  process.exit(0)
}

if (!skipDeploy && !(await commandExists("railway"))) {
  throw new Error("Railway CLI is not installed or not on PATH")
}

if (!(await commandExists("yarn"))) {
  throw new Error("yarn is not installed or not on PATH")
}

if (!skipDeploy) {
  const ready = await waitForRailway(attempts, delayMs)
  if (!ready) {
    throw new Error("Railway did not become ready; not deploying")
  }

  await run("railway", ["up", "--detach"])
} else {
  console.log("\nSkipping Railway deploy; checking the configured backend URL.")
}

await maybeVerifyGithubDeployment()

if (!skipBackendWait) {
  const healthy = await waitForBackend(backendUrl, backendAttempts, backendDelayMs)
  if (!healthy) {
    throw new Error("Backend did not become healthy after deployment")
  }
}

const smokeEnv = { MEDUSA_BACKEND_URL: backendUrl }

await run("yarn", ["smoke:production-backend"], { env: smokeEnv })

if (!skipFrontend) {
  if (!fs.existsSync(path.join(frontendDir, "package.json"))) {
    throw new Error(`Frontend repo not found at ${frontendDir}`)
  }

  await run("yarn", ["smoke:storefront-backend"], {
    cwd: frontendDir,
    env: smokeEnv,
  })
}

console.log("\nProduction backend recovery checks passed.")
