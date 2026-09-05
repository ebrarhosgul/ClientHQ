# ClientHQ

A multi tenant portal where agencies manage their clients, projects, deliverables
and invoices, and each of their clients gets a read only window onto their own
work. Agencies pay a monthly subscription; no client money moves through the
platform.

The stack and the tenancy model are settled in
[spec 0001](docs/specs/0001-stack-and-foundational-architecture/index.md). The
feature roadmap lives in [the scope](docs/scope/scope.md).

## Running it

You need Node 22 or newer and pnpm.

```bash
corepack pnpm install
cp .env.example .env   # then fill in DATABASE_URL and DIRECT_URL
corepack pnpm dev
```

If you want a plain `pnpm` command rather than `corepack pnpm`, install it once
with `corepack enable pnpm` (that needs write access to your global bin
directory) or with pnpm's own installer.

`.env.local` works too and takes precedence, matching how Next resolves them.
The migration tooling and the scripts follow the same order, so your values
cannot end up reaching one and not the other.

The app serves on http://localhost:3000. Visit `/api/health/db` to confirm the
database link, or run `pnpm db:check` from the terminal.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | TypeScript, no emit |
| `pnpm db:check` | One round trip to Postgres through Drizzle, writes nothing |
| `pnpm db:generate` | Generate a migration from the schema |
| `pnpm db:migrate` | Apply migrations, over `DIRECT_URL` |
| `pnpm db:studio` | Drizzle Studio |

`pnpm typecheck` needs `.next/types`, which a build or a dev run generates. Run
`pnpm build` first in a clean checkout.

## Layout

```
src/
  app/                 Routes. App Router.
    api/health/db/     Is the database reachable?
  db/
    client.ts          The raw Drizzle handle. Read the warning in it.
    schema.ts          Tables. Empty until feature 3.
  lib/
    env.ts             Environment, validated with Zod.
drizzle/               Generated migration SQL, committed and reviewable.
scripts/               One off scripts run with tsx.
docs/                  Scope and specs.
```

Routes arrive with their features rather than as empty folders. Spec 0001 fixes
where each one goes: the agency application at `/dashboard`, `/clients`,
`/projects`, `/invoices`, `/settings` and `/billing`, the client portal under
`/portal`, webhooks at `/api/webhooks/stripe` and `/api/webhooks/clerk`, and the
daily sweep at `/api/cron/daily`.

## The one rule that matters

Every tenant scoped table carries an `org_id`, and **nothing outside the tenant
scoping data access layer may import the raw database handle from
`src/db/client.ts`**.

This scoping fails open. A single query that skips the helper leaks one agency's
rows to another, and nothing in the database stops it. Two pieces are still owed
and are tracked in the scope: feature 4 builds the scoped query builder, and
feature 2 adds the ESLint rule that makes bypassing it fail the build. Until
both land, the guarantee is discipline rather than construction.

## Connection notes

`DATABASE_URL` is the Supabase transaction mode pooler on port 6543, and Drizzle
runs against it with prepared statements switched off. PgBouncer hands each
transaction a different backend connection, and a named prepared statement does
not survive that. `DIRECT_URL` is the direct connection on port 5432 and is used
by migrations only.

The Supabase free tier pauses a project after about a week without traffic. The
daily cron route's own queries double as the keep alive.
