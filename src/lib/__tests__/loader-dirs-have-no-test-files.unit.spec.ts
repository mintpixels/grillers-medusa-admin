import fs from "fs"
import path from "path"

/**
 * Guard against a silent, deploy-stranding failure mode.
 *
 * Medusa's loaders import EVERY .ts file under certain source directories at
 * boot (subscribers, jobs, workflows, links, scheduled-jobs). A Jest test file
 * placed in one of those trees (a `*.spec.ts` / `*.test.ts`, or anything under a
 * `__tests__/` folder) is imported at startup, references `describe`/`jest`
 * (undefined at runtime), and crashes the server with "describe is not defined".
 *
 * The insidious part: `yarn test:unit` stays GREEN (Jest happily runs the file),
 * `yarn build` succeeds, and only the deploy fails its health check — so the
 * backend pipeline can silently stop deploying for days while CI looks fine.
 * (This is exactly what happened: a subscriber test stranded prod from
 * 2026-06-16 until it was found.)
 *
 * This test makes that failure mode a RED unit test instead of a silent deploy
 * failure. Put subscriber/job/workflow tests in `src/lib/__tests__/` or
 * `src/modules/<name>/__tests__/` (not loader-scanned) instead.
 */

// Directories Medusa greedily imports every file from at boot.
const LOADER_DIRS = [
  "subscribers",
  "jobs",
  "workflows",
  "links",
  "scheduled-jobs",
]

const SRC_ROOT = path.resolve(__dirname, "..", "..") // src/lib/__tests__ -> src

// Flags loadable test files only — a `*.spec`/`*.test` file anywhere, OR any
// `.ts/.js` inside a `__tests__/` folder (the loader imports those too). Empty
// `__tests__` dirs are harmless (nothing to import) and are not flagged.
function findTestFiles(dir: string, insideTestsDir = false): string[] {
  if (!fs.existsSync(dir)) return []
  const offenders: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      offenders.push(
        ...findTestFiles(full, insideTestsDir || entry.name === "__tests__")
      )
    } else if (
      /\.[jt]s$/.test(entry.name) &&
      (insideTestsDir || /\.(spec|test)\.[jt]s$/.test(entry.name))
    ) {
      offenders.push(full)
    }
  }
  return offenders
}

describe("Medusa loader directories contain no test files", () => {
  for (const dir of LOADER_DIRS) {
    it(`src/${dir}/ has no *.spec/*.test/__tests__ files (they crash the server at boot)`, () => {
      const offenders = findTestFiles(path.join(SRC_ROOT, dir)).map((p) =>
        path.relative(SRC_ROOT, p)
      )

      if (offenders.length > 0) {
        throw new Error(
          `Found test file(s) under src/${dir}/ — Medusa imports these at boot and the ` +
            `server crashes with "describe is not defined", silently failing every deploy.\n` +
            `Move them to src/lib/__tests__/ or src/modules/<name>/__tests__/:\n  ` +
            offenders.join("\n  ")
        )
      }

      expect(offenders).toEqual([])
    })
  }
})
