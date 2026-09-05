/**
 * @vitest-environment node
 *
 * Tests for the `pnpm db:check` script.
 *
 * The script runs on import and calls `process.exit`, so it is tested the way it
 * is used: as a child process. Only the failure paths are covered, because the
 * success path needs a live Supabase project, which is not something a unit
 * suite should depend on. `/check verify` covers success by hand.
 *
 * A deliberately unparseable DATABASE_URL is used so the driver fails while
 * building its connection, before any network call. That keeps this fast and
 * offline.
 */
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPT = resolve(process.cwd(), "scripts/db-check.ts");
// The tsx binary is resolved absolutely, rather than through `node --import
// tsx`, so the child does not have to look the loader up for itself.
const TSX = resolve(process.cwd(), "node_modules/.bin/tsx");

type Failure = { code?: number; stdout: string; stderr: string };

/**
 * Run the script as a child process, from the project root.
 *
 * The root matters, because tsx reads the `@/*` path alias out of tsconfig.json
 * relative to the working directory. Values passed here still beat the project's
 * own .env, since dotenv never overwrites a key that is already set.
 */
async function runDbCheck(env: Record<string, string>): Promise<Failure> {
  try {
    const { stdout, stderr } = await run(TSX, [SCRIPT], {
      cwd: process.cwd(),
      // Only PATH plus what the test sets: NODE_ENV and friends are not needed
      // and their absence is part of what is under test.
      env: {
        PATH: process.env.PATH ?? "",
        ...env,
      } as unknown as NodeJS.ProcessEnv,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as Failure & { code?: number };
    return {
      code: failure.code,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

const UNREACHABLE = {
  DATABASE_URL: "not-a-connection-string",
  DIRECT_URL: "not-a-connection-string",
};

describe("db:check", () => {
  it("exits non zero when the database cannot be reached", async () => {
    const result = await runDbCheck(UNREACHABLE);

    // CI has to be able to tell a failed check from a passing one.
    expect(result.code).not.toBe(0);
  }, 90_000);

  it("says plainly that it could not reach the database", async () => {
    const result = await runDbCheck(UNREACHABLE);

    expect(result.stderr).toContain("Could not reach the database.");
  }, 90_000);

  it("tells you where to look, naming the variable and the pooler port", async () => {
    const result = await runDbCheck(UNREACHABLE);

    // The most common cause is the wrong port, so the message says which.
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stderr).toContain("6543");
  }, 90_000);

  it("reports the environment problem when DATABASE_URL is set but empty", async () => {
    // An empty value still counts as present, so the .env file does not fill
    // it in. This is the "you forgot to configure it" path, and it has to name
    // the variable rather than fail somewhere deep inside the driver.
    const result = await runDbCheck({ DATABASE_URL: "", DIRECT_URL: "" });

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL is required");
    expect(result.stderr).toContain(".env.example");
  }, 90_000);

  it("prints nothing to stdout when it fails, so a pipe stays clean", async () => {
    const result = await runDbCheck(UNREACHABLE);

    expect(result.stdout.trim()).toBe("");
  }, 90_000);
});
