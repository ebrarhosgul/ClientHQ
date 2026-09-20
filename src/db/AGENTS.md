# Database

## Overview

Everything that talks to PostgreSQL: the connection handle, the Drizzle schema, and the tenant scoping data access layer in `src/db/tenant/` that every read and write goes through. This area carries the single rule the whole product's security rests on, which is why it has its own doc.

## Key files

| File | Owns |
|---|---|
| `src/db/client.ts` | The raw Drizzle handle and the Supabase pooler connection settings |
| `src/db/schema/` | The Drizzle table definitions, one file per area, re-exported from `src/db/schema/index.ts`. Settled by spec 0002 |
| `src/db/tenant/` | The tenant scoping data access layer: context resolution, the scoped accessor, the action wrapper, the role guards and the named system access door. Settled by spec 0003 |
| `tools/eslint/` (repo root) | The two rules that fence this area: `no-raw-db-import` and `no-system-access-import` |
| `drizzle.config.ts` (repo root) | Migration config. Points at `DIRECT_URL`, not the pooler |
| `drizzle/` (repo root) | Generated SQL migrations, committed so schema changes are reviewable |
| `scripts/db-check.ts` (repo root) | A terminal check that the connection works |
| `src/app/api/health/db/route.ts` | The same check from inside the running app |
| `scripts/migrations-check.ts` (repo root) | Fails when the schema and the committed migrations have drifted apart |
| `scripts/db-schema-assert.ts` (repo root) | Reads the PostgreSQL catalogue and checks the live schema against spec 0002 |
| `scripts/db-seed.ts` (repo root) | A repeatable development seed, guarded so it refuses a non local host. It first deletes every row in the seed's fixed id namespace (`0190a000-0000-7000-8000-…`), then writes the dataset from `scripts/seed-dataset.ts` and uploads the bytes from `scripts/seed-files.ts` to R2 when configured. Real agencies have generated ids and are never touched, unless `SEED_CLERK_ORG_ID` (a Clerk `org_...` id) binds Apex to one: that organization keeps its own row, admin, memberships and subscription, and its clients, projects, contacts, files and invoices are copied to `.seed-backups/` (git ignored, may hold real emails) and then replaced |

## Commands

```bash
corepack pnpm db:generate       # generate a migration from src/db/schema/
corepack pnpm db:migrate        # apply migrations (uses DIRECT_URL)
corepack pnpm db:migrate:check  # fail if schema and migrations have drifted apart
corepack pnpm db:schema:assert  # check the live schema against spec 0002
corepack pnpm db:seed           # seed development data (refuses a non local host)
corepack pnpm db:studio         # browse the data
corepack pnpm db:check          # confirm the connection works
```

## Conventions

- Two connection strings, and they are not interchangeable. `DATABASE_URL` is the Supabase transaction mode pooler on port 6543 and serves every runtime query. `DIRECT_URL` is the direct connection on port 5432 and is for migrations only.
- Migrations are generated, committed under `drizzle/`, and reviewed in a pull request. Never hand edit generated SQL; change the tables under `src/db/schema/` and generate again.
- Every read and write against a tenant scoped table goes through `tenantDb(ctx)` from `src/db/tenant`, and every Server Action through `withTenantAction()`. The tenant context is a required argument, never something a query resolves for itself.
- Every tenant scoped table carries a not null `org_id` column and is indexed on it. Eight of the eleven tables are tenant scoped; `organizations` (the tenant itself), `users` and `processed_webhook_events` are the three that are not.
- Insert and select schemas come from drizzle-zod in `src/db/schema/zod.ts` and are re-exported from `src/db/schema`. Parse input against those rather than casting it.
- All money is stored as integer cents with an explicit currency column. Never floating point.
- Column names are `snake_case`; the TypeScript fields Drizzle exposes are `camelCase`.

## Gotchas

- **Nothing outside the data access layer may import `db` from `src/db/client.ts`.** A query against a tenant scoped table with no `org_id` predicate leaks one agency's rows to another, and nothing in the database stops it. Spec 0001 is explicit that this scoping fails open. `clienthq/no-raw-db-import` in `tools/eslint/no-raw-db-import.mjs` makes a stray import fail the build. It exempts `src/db/tenant/**` (the one directory that reaches the handle, through `src/db/tenant/executor.ts`) plus three exact paths: the two connection health checks and the handle's own test. The scoping layer it protects now exists, so `tenantDb(ctx)` applies `org_id` for you and scoping is construction rather than discipline.
- **`withSystemAccess` is the unscoped door, and it is fenced too.** `clienthq/no-system-access-import` in `tools/eslint/no-system-access-import.mjs` limits it to the three callers with no tenant to resolve: the Stripe and Clerk webhook routes and the daily cron route. `tools/eslint/tenant-isolation-config.test.mts` fails if either exemption list and spec 0003 stop agreeing, so widening one is a pull request discussion rather than a quiet edit.
- **Prepared statements are switched off** (`prepare: false`). PgBouncer in transaction mode hands each transaction a different backend connection, and a named prepared statement does not survive that. Turning this back on produces runtime errors that look nothing like their cause.
- **The pool is capped at one connection** and cached on `globalThis` in development. Serverless functions are short lived and many, and the Supabase free tier connection budget is small. Removing the cache means every hot reload opens another pool.
- **A build must never need real credentials.** `env()` is a function rather than a top level constant for this reason, and the health route imports `db` inside the handler rather than at module scope. Keep new database code out of module scope in anything that gets prerendered.
- **Tenant context is resolved from the Clerk session or the signed in user's `ClientContact` row.** Never from a URL segment, a form field, or a header.
- **Permission checks read the Clerk session claim, not `Membership.role`.** The local role column is a display mirror and can be stale until a webhook lands.
- The Supabase free tier pauses a project after roughly a week of inactivity. The daily cron route's own queries are what keep it awake, so that is not a separate job.

## Agent skills

- [drizzle](../../.agents/skills/drizzle/): Drizzle ORM query and schema conventions
- [drizzle-migrations](../../.agents/skills/drizzle-migrations/): generating and applying migrations safely
- [supabase-postgres-best-practices](../../.agents/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, load before writing or changing anything in Postgres
- [supabase](../../.agents/skills/supabase/): `supabase/agent-skills`, platform and connection conventions
- [postgresql-table-design](../../.agents/skills/postgresql-table-design/): types, constraints, indexes
- [sql-optimization-patterns](../../.agents/skills/sql-optimization-patterns/): query plans and indexing when something is slow
- [database-migration](../../.agents/skills/database-migration/) and [db-seed](../../.agents/skills/db-seed/): migration strategy and seed data

## Related specs

- [Spec 0001](../../docs/specs/0001-stack-and-foundational-architecture/index.md): tenant isolation, the data model sketch, and the connection constraints
- [Spec 0002](../../docs/specs/0002-data-model-and-migrations/index.md): every table, column, constraint, index and cascade, plus the money rules and the seed guard
- [Spec 0003](../../docs/specs/0003-tenant-scoping-data-access-layer/index.md): the scoping layer built here, in `src/db/tenant/`, plus the ESLint exemption lists it fixes

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
