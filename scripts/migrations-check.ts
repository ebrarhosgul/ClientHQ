/**
 * The migration check CI runs on every push and pull request.
 *
 * Migrations are generated from `src/db/schema/` and committed under
 * `drizzle/` so schema changes are reviewable. That only holds if the two never
 * drift apart, which is exactly what a reviewer cannot see by eye. This script
 * makes the drift fail a build instead.
 *
 * It asks two questions:
 *
 *   1. Does every journal entry have its SQL file, and every SQL file its
 *      journal entry? A migration committed without its journal line is never
 *      applied, and a journal line without its file crashes the migrator.
 *   2. Would generating right now produce a new migration? If it would, someone
 *      changed the schema and did not run `pnpm db:generate`.
 *
 * It needs no database. Generation is a diff between the schema and the
 * snapshots already in `drizzle/meta/`, so this runs anywhere, including a CI
 * job with no credentials.
 *
 * Run it with `pnpm db:migrate:check`. It writes nothing into `drizzle/`: the
 * trial generation goes to a throwaway copy in the system temp directory.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import drizzleConfig from "../drizzle.config";

type Result =
  | { readonly ok: true }
  | { readonly ok: false; readonly problem: string; readonly hint: string };

type JournalEntry = { readonly tag: string };
type Journal = { readonly entries: readonly JournalEntry[] };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MIGRATIONS_DIR = path.resolve(ROOT, drizzleConfig.out ?? "./drizzle");
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, "meta", "_journal.json");

/** `schema` may be one path or several. Normalise it to a list. */
const SCHEMA_PATHS = (
  Array.isArray(drizzleConfig.schema)
    ? drizzleConfig.schema
    : [drizzleConfig.schema]
).filter((entry): entry is string => typeof entry === "string");

const sqlFilesIn = (directory: string): readonly string[] =>
  fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(".sql"))
        .sort()
    : [];

/** Every journal entry has its SQL file, and every SQL file its journal entry. */
function checkJournal(): Result {
  if (!fs.existsSync(JOURNAL_PATH)) {
    return {
      ok: false,
      problem: `No migration journal at ${path.relative(ROOT, JOURNAL_PATH)}.`,
      hint: "Run `pnpm db:generate` once to create it.",
    };
  }

  const journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf8")) as Journal;

  const claimed = journal.entries.map((entry) => `${entry.tag}.sql`).sort();
  const onDisk = sqlFilesIn(MIGRATIONS_DIR);

  const missing = claimed.filter((name) => !onDisk.includes(name));
  const orphaned = onDisk.filter((name) => !claimed.includes(name));

  if (missing.length === 0 && orphaned.length === 0) return { ok: true };

  return {
    ok: false,
    problem: [
      missing.length > 0
        ? `The journal names migrations with no SQL file: ${missing.join(", ")}.`
        : undefined,
      orphaned.length > 0
        ? `These SQL files are in no journal entry, so they never run: ${orphaned.join(", ")}.`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    hint:
      "The journal and the SQL files under `drizzle/` are generated together. " +
      "Commit both, and never hand edit either one.",
  };
}

/** Would generating right now produce a migration that is not committed? */
function checkForDrift(): Result {
  const workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "clienthq-migrations-"),
  );

  try {
    fs.cpSync(MIGRATIONS_DIR, workspace, { recursive: true });

    const before = sqlFilesIn(workspace);

    // The `--out` flag makes drizzle-kit ignore the config file entirely, so
    // schema and dialect have to travel with it.
    const binary = path.join(
      ROOT,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit",
    );

    const generated = spawnSync(
      binary,
      [
        "generate",
        ...SCHEMA_PATHS.flatMap((schema) => ["--schema", schema]),
        "--dialect",
        String(drizzleConfig.dialect),
        "--out",
        workspace,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

    if (generated.status !== 0) {
      return {
        ok: false,
        problem: `drizzle-kit could not generate:\n${generated.stderr || generated.stdout}`,
        hint: "Fix the error above, then run `pnpm db:migrate:check` again.",
      };
    }

    const added = sqlFilesIn(workspace).filter(
      (name) => !before.includes(name),
    );

    if (added.length === 0) return { ok: true };

    return {
      ok: false,
      problem:
        `\`${SCHEMA_PATHS.join("`, `")}\` has changes with no committed migration. ` +
        `Generating now would add: ${added.join(", ")}.`,
      hint: "Run `pnpm db:generate` and commit the new migration alongside the schema change.",
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const results: readonly [string, Result][] = [
  ["journal and SQL files agree", checkJournal()],
  ["schema and migrations are in step", checkForDrift()],
];

const failures = results.filter(
  (entry): entry is [string, Extract<Result, { ok: false }>] => !entry[1].ok,
);

for (const [label, result] of results) {
  console.log(`${result.ok ? "ok  " : "FAIL"}  ${label}`);
}

if (failures.length > 0) {
  for (const [, result] of failures) {
    console.error(`\n${result.problem}\n\n${result.hint}`);
  }
  process.exit(1);
}

console.log("\nMigrations are in step with the schema.");
