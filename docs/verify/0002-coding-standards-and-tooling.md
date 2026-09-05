# Verify: coding standards & tooling · scope feature 2 · updated 2026-09-05

_Feature 2 has no spec of its own. Its decisions live in [AGENTS.md](../../AGENTS.md) under `## Tooling`, and its acceptance criteria are the **Done when** line and the description in [the scope](../scope/scope.md). `DW-n` below are the Done when clauses in order; `F-n` are the two things the feature description promises that the Done when line does not spell out. `/check verify` runs these; `/test` locks the durable ones._

_This file sits in `docs/verify/` rather than beside a spec because there is no spec to sit beside. If `/architect` ever writes one for this feature, move it there._

| Tag | The criterion |
|---|---|
| DW-1 | Root `AGENTS.md` reflects the real stack and the installed skills |
| DW-2 | Lint, format and typecheck run clean |
| DW-3 | The raw database handle import rule actually fails a build when violated |
| F-1 | A pre-commit hook runs lint, format and typecheck on staged files |
| F-2 | CI runs on every push and pull request: lint, typecheck, unit tests, migration check |

## Commands

- [ ] `corepack pnpm format:check` → `All matched files use Prettier code style!`, exit 0 → DW-2
- [ ] `corepack pnpm lint` → no findings, exit 0 → DW-2
- [ ] `corepack pnpm typecheck` → `Types generated successfully` then no type errors, exit 0 → DW-2
- [ ] `corepack pnpm test` → every file passes, including `tools/eslint/no-raw-db-import.test.mts` → DW-3
- [ ] `corepack pnpm db:migrate:check` → both lines report `ok`, exit 0 → F-2

## The tenant isolation rule really bites

The rule resolves specifiers to real paths, so each spelling below is a separate way of naming the same file and each has to be caught. Delete the scratch file after each one.

- [ ] Put `import { db } from "@/db/client";` in `src/scratch.ts` → `corepack pnpm lint` exits non zero, naming `clienthq/no-raw-db-import` → DW-3
- [ ] Same file, `import { db } from "../db/client";` → reported → DW-3
- [ ] Same file, `import { db } from "@/db/client.ts";` (with the extension) → reported → DW-3
- [ ] Same file, `const { db } = await import("@/db/client");` inside a function → reported → DW-3
- [ ] Same file, `export * from "@/db/client";` (re-exporting launders the import) → reported → DW-3
- [ ] `corepack pnpm exec eslint src/db src/app/api/health/db/route.ts scripts/db-check.ts` → exit 0. The data access layer and the two sanctioned health checks are exempt on purpose, and the exemptions are listed in `eslint.config.mjs`, not hidden in the rule → DW-3

## The migration check really bites

- [ ] Add a table to `src/db/schema.ts` without running `db:generate` → `corepack pnpm db:migrate:check` exits non zero and names the migration it would have written → F-2
- [ ] Straight after that failure, `git status --porcelain drizzle/` → empty. The check generates into a temp directory, so a failing check never leaves a stray migration behind → F-2
- [ ] Restore `src/db/schema.ts` → the check passes again → F-2
- [ ] Delete a `.sql` file under `drizzle/` while leaving its journal entry → the check fails on the journal, not on drift → F-2

## The pre-commit hook

- [ ] `git config --get core.hooksPath` → `.githooks` → F-1
- [ ] Fresh clone, then `corepack pnpm install` → the install prints `install-git-hooks: core.hooksPath -> .githooks` → F-1
- [ ] Stage a badly formatted file and `git commit` → refused, pointing at `pnpm format`; `git log --oneline -1` unchanged → F-1
- [ ] Stage a file importing the raw handle and `git commit` → refused, naming the lint rule → F-1
- [ ] A commit that breaks a type in a file you did not stage → still refused. Typecheck runs across the project on purpose, because one file cannot be typechecked honestly on its own → F-1
- [ ] `git commit --no-verify` on any of the above → commits. The escape is documented in the hook and CI catches it anyway → F-1

## CI

- [ ] Push a branch → the CI workflow runs and all five checks pass → F-2
- [ ] Open a pull request → the same workflow runs on the pull request too → F-2
- [ ] Break formatting on a branch and push → CI fails on `Formatting` **and still reports** Lint, Typecheck, Unit tests and Migration check, rather than stopping at the first failure → F-2
- [ ] No CI step asks for a secret. Confirm the run is green on a checkout with no `.env` and no database → F-2

## Coverage

- **DW-1** is `/audit`'s box, not this build's. `AGENTS.md` and `src/db/AGENTS.md` are already written and committed, so it is satisfied; its checkbox in the scope is simply not ticked yet.
- **DW-2** covered by the first three command steps.
- **DW-3** covered by the `pnpm test` step and every step under "The tenant isolation rule really bites".
- **F-1** covered by the pre-commit hook steps.
- **F-2** covered by the `db:migrate:check` step, "The migration check really bites", and the CI steps.
