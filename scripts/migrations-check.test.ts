/**
 * @vitest-environment node
 *
 * covers: F-2 (CI runs a migration check on every push and pull request)
 *
 * Tests for `pnpm db:migrate:check`.
 *
 * The script runs on import and calls `process.exit`, so it is tested the way
 * CI uses it: as a child process, judged by its exit code and what it printed.
 * It needs no database, which is the reason it can be a CI gate at all.
 *
 * Two of these cases put `drizzle/` into a broken state on purpose, because a
 * check nobody has watched fail is only a guess. The original journal is read
 * once before anything runs and written back after every case, and any file
 * these tests add is removed the same way. If a run is ever killed part way
 * through, `git checkout drizzle/` puts it right.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);

const ROOT = process.cwd();
const SCRIPT = path.resolve(ROOT, "scripts/migrations-check.ts");
const TSX = path.resolve(ROOT, "node_modules/.bin/tsx");

const MIGRATIONS_DIR = path.resolve(ROOT, "drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** A schema file that exists only while the drift test runs. */
const DRIFT_TABLE_PATH = path.resolve(
  ROOT,
  "src/db/schema/zz-drift-for-test.ts",
);

type Outcome = {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
};

async function runCheck(): Promise<Outcome> {
  try {
    const { stdout, stderr } = await run(TSX, [SCRIPT], {
      cwd: ROOT,
      timeout: 120_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

/** What the committed repository looks like, captured before anything moves. */
let originalJournal = "";
let originalFiles: readonly string[] = [];

beforeAll(() => {
  originalJournal = fs.readFileSync(JOURNAL_PATH, "utf8");
  originalFiles = fs.readdirSync(MIGRATIONS_DIR).sort();
});

afterEach(() => {
  fs.writeFileSync(JOURNAL_PATH, originalJournal);
  fs.rmSync(DRIFT_TABLE_PATH, { force: true });

  for (const name of fs.readdirSync(MIGRATIONS_DIR)) {
    if (!originalFiles.includes(name)) {
      fs.rmSync(path.join(MIGRATIONS_DIR, name), {
        recursive: true,
        force: true,
      });
    }
  }
});

/** Add a journal entry for a migration whose SQL file was never committed. */
function addGhostJournalEntry(tag: string) {
  const journal = JSON.parse(originalJournal) as {
    entries: readonly unknown[];
  };

  fs.writeFileSync(
    JOURNAL_PATH,
    JSON.stringify({
      ...journal,
      entries: [
        ...journal.entries,
        {
          idx: journal.entries.length,
          version: "7",
          when: 0,
          tag,
          breakpoints: true,
        },
      ],
    }),
  );
}

describe("db:migrate:check on the committed repository", () => {
  it("passes, reporting both checks as ok", async () => {
    const result = await runCheck();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ok");
    expect(result.stdout).toContain("journal and SQL files agree");
    expect(result.stdout).toContain("schema and migrations are in step");
  }, 150_000);

  it("neither reports FAIL nor writes to stderr when everything is in step", async () => {
    // CI reads the exit code, but a person reads the log. A passing run that
    // still prints a problem trains everyone to ignore the output.
    const result = await runCheck();

    expect(result.stdout).not.toContain("FAIL");
    expect(result.stderr.trim()).toBe("");
  }, 150_000);

  it("leaves drizzle/ exactly as it found it", async () => {
    // The trial generation goes to a throwaway copy in the system temp
    // directory. Generating into `drizzle/` would mean the check quietly
    // creates the very migration it is meant to complain about.
    await runCheck();

    const { stdout } = await run("git", ["status", "--porcelain", "drizzle/"], {
      cwd: ROOT,
    });

    expect(stdout.trim()).toBe("");
  }, 150_000);
});

describe("db:migrate:check when the journal and the SQL files disagree", () => {
  it("fails on a SQL file that no journal entry names, so it would never run", async () => {
    fs.writeFileSync(
      path.join(MIGRATIONS_DIR, "9999_orphan_for_test.sql"),
      "-- added by migrations-check.test.ts\n",
    );

    const result = await runCheck();

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
    expect(result.stderr).toContain("9999_orphan_for_test.sql");
    expect(result.stderr).toContain("never run");
  }, 150_000);

  it("fails on a journal entry whose SQL file is missing, which would crash the migrator", async () => {
    addGhostJournalEntry("9999_ghost_for_test");

    const result = await runCheck();

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("9999_ghost_for_test.sql");
  }, 150_000);

  it("says what to do about it rather than only what is wrong", async () => {
    fs.writeFileSync(
      path.join(MIGRATIONS_DIR, "9999_orphan_for_test.sql"),
      "-- added by migrations-check.test.ts\n",
    );

    const result = await runCheck();

    // Whoever hits this in CI has probably never seen the journal before.
    expect(result.stderr).toContain("generated together");
  }, 150_000);
});

describe("db:migrate:check when the schema has changed without a migration", () => {
  it("fails, naming the migration that generating would add", async () => {
    // A table drizzle-kit has never seen. Every file in `src/db/schema/` is
    // part of the schema, so this alone is a change with no migration.
    fs.writeFileSync(
      DRIFT_TABLE_PATH,
      [
        'import { pgTable, text } from "drizzle-orm/pg-core";',
        "",
        'export const zzDriftForTest = pgTable("zz_drift_for_test", {',
        '  id: text("id").primaryKey(),',
        "});",
        "",
      ].join("\n"),
    );

    const result = await runCheck();

    // This is the case that once passed silently: drizzle-kit could not read
    // the snapshot from an absolute `--out` path, printed the error, and
    // exited zero anyway.
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain("FAIL");
    expect(result.stderr).toContain("no committed migration");
  }, 150_000);
});
