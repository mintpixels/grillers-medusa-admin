#!/usr/bin/env node

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import process from "node:process"

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

const attempts = Number(argValue("attempts") || (hasFlag("wait") ? 30 : 1))
const delayMs = Number(argValue("delay-ms") || 60_000)
const frontendDir = path.resolve(
  argValue("frontend-dir") ||
    process.env.FRONTEND_DIR ||
    path.join(process.cwd(), "..", "grillers-medusa-frontend")
)
const skipDeploy = hasFlag("skip-deploy")
const skipFrontend = hasFlag("skip-frontend")

if (hasFlag("help")) {
  console.log(`Usage:
  yarn recover:production-backend [options]

Options:
  --wait                  Poll Railway up to 30 times before giving up.
  --attempts <n>          Number of Railway readiness attempts. Default: 1.
  --delay-ms <ms>         Delay between readiness attempts. Default: 60000.
  --skip-deploy           Do not run railway up; only run smoke checks.
  --skip-frontend         Do not run the storefront/backend smoke check.
  --frontend-dir <path>   Frontend repo path. Default: ../grillers-medusa-frontend.

Required external tools:
  railway
  yarn
`)
  process.exit(0)
}

if (!(await commandExists("railway"))) {
  throw new Error("Railway CLI is not installed or not on PATH")
}

if (!(await commandExists("yarn"))) {
  throw new Error("yarn is not installed or not on PATH")
}

const ready = await waitForRailway(attempts, delayMs)
if (!ready) {
  throw new Error("Railway did not become ready; not deploying")
}

if (!skipDeploy) {
  await run("railway", ["up", "--detach"])
}

await run("yarn", ["smoke:production-backend"])

if (!skipFrontend) {
  if (!fs.existsSync(path.join(frontendDir, "package.json"))) {
    throw new Error(`Frontend repo not found at ${frontendDir}`)
  }

  await run("yarn", ["smoke:storefront-backend"], { cwd: frontendDir })
}

console.log("\nProduction backend recovery checks passed.")
