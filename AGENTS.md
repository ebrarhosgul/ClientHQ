<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ClientHQ

A multi tenant portal where agencies manage their clients, projects, deliverables and invoices, and each of their clients gets a read only window onto their own work. Agencies pay a monthly subscription; no client money moves through the platform.

## Stack

Settled in [spec 0001](docs/specs/0001-stack-and-foundational-architecture/index.md), which is the source of truth for this section.

- **Language / Runtime**: TypeScript 5 on Node 22 LTS
- **Framework**: Next.js 16 App Router (React 19), Server Components for reads, Server Actions for writes
- **Key dependencies**: Drizzle ORM over PostgreSQL on Supabase, Zod, Tailwind CSS v4 with shadcn/ui
- **Providers**: Clerk (auth and agency organizations), Stripe (subscription), Cloudflare R2 (files), Resend (email), a Postgres counter table (rate limits, spec 0018), Sentry (errors), PostHog (product analytics), Vercel (hosting)
- **Package manager**: pnpm 11 (`corepack pnpm` if pnpm is not on your path)

## Build approach

Tracer Bullet: prove the whole pipe works end to end before building any part of it fully.

## Commands

```bash
# Install
corepack pnpm install

# Dev server (http://localhost:3000)
corepack pnpm dev

# Build
corepack pnpm build

# Test (unit, then end to end)
corepack pnpm test
corepack pnpm test:e2e

# Typecheck, lint and format
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm format
corepack pnpm format:check

# Database: generate a migration, apply it, check the connection
corepack pnpm db:generate
corepack pnpm db:migrate
corepack pnpm db:check

# Database: catch uncommitted schema drift, assert the live schema, seed dev data
corepack pnpm db:migrate:check
corepack pnpm db:schema:assert
corepack pnpm db:seed
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title/index.md`. The feature roadmap is [docs/scope/scope.md](docs/scope/scope.md).

## Rules

Code style is functional and immutable. No classes where a plain function works.

- Functions are pure by default. Push side effects (database, network, Stripe, R2) to the edges and keep them explicit.
- Data is immutable. Use `const` and `readonly`; never mutate in place. Module level variables are constants only.
- Prefer composition over inheritance, and `map` / `filter` / `reduce` over imperative loops where it reads better.
- Expected failures are returned as values (a `Result` shape), not thrown. Throw only for genuinely exceptional cases, and let webhook handlers throw so the provider retries.
- Avoid `null`. Prefer explicit `undefined` with union types.
- Types are strict: no `any`, no unchecked casts, exhaustive switches over the status enums (invoice status, subscription status).
- Zod parses every input crossing into the server (Server Action arguments, route handler bodies, webhook payloads, URL params) before use. Never a bare cast at a trust boundary.
- Named exports only, except where Next.js requires a default (pages, layouts, route handlers).
- Every environment variable is added to the Zod schema in `src/lib/env.ts` and read through `env()`. Never `process.env` directly.
- Naming: `snake_case` for database tables and columns, `camelCase` in TypeScript, `kebab-case` for file names. So `org_id` in SQL is `orgId` in code.
- Every UI surface meets WCAG 2.2 AA, including its empty and error states.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `chore:`).
- **The load bearing rule**: nothing outside the tenant scoping data access layer may import the raw database handle from `src/db/client.ts`. See [src/db/AGENTS.md](src/db/AGENTS.md).
- **Provider SDK boundaries**: only `src/storage/` (and `scripts/r2-setup.ts`) may import `@aws-sdk/*`, and only `src/invoices/pdf/` may import `@react-pdf/*`. ESLint fails the build otherwise; go through `@/storage` and `@/invoices/pdf/render`.

## Layout

`src/app` holds routes only. `src/db` and `src/lib` hold shared infrastructure. Features get their own folder under `src` (`src/auth`, `src/payments`, `src/invoices`, `src/clients`) holding their own logic, queries and tests. Tests sit beside the source they cover, named `*.test.ts`.

## Tooling

Chosen here, installed by `/develop tooling` (scope feature 2). All of it is in place.

- **Lint and format**: keep ESLint 9 with `eslint-config-next`, add Prettier alongside it, wired so the two do not fight.
- **Before each commit**: `.githooks/pre-commit` checks formatting and lint on the staged files and typechecks the whole project. `pnpm install` points `core.hooksPath` at `.githooks/` (see `scripts/install-git-hooks.mjs`); `git commit --no-verify` skips it.
- **Continuous integration**: `.github/workflows/ci.yml` on every push and pull request, running format, lint, typecheck, unit tests and a migration drift check, plus a second job that applies every migration to a throwaway PostgreSQL and asserts the resulting schema. `.github/workflows/migrate.yml` migrates the deployed database on merge to `main` and only then triggers the deploy, so Vercel's own git deploys for `main` are turned off in `vercel.json`.
- **Custom ESLint rules**: `clienthq/no-raw-db-import` in `tools/eslint/no-raw-db-import.mjs` blocks importing `src/db/client.ts` from anywhere outside `src/db/tenant/`, with three named exemptions (the two connection health checks and the handle's own test). `clienthq/no-system-access-import` blocks the unscoped `withSystemAccess` door outside the two webhook routes and the daily cron route. `tools/eslint/tenant-isolation-config.test.mts` fails if either exemption list stops matching spec 0003. Spec 0001 treats this as required, not tidying.
- **Testing gate**: Vitest unit tests on money, permission and tenancy logic; integration tests on the data access layer and webhooks; Playwright for sign up, invite and checkout. Written after the build.

## Git

- integration: on
- branch prefix: `feat/`
- commit: per-milestone

## Agent skills

74 skills are installed in `.agents/skills/`, linked from `.claude/skills/`. They are third party content and spec 0001 flags that they were installed in bulk rather than vetted individually. The project wide ones are below; the rest load from the area docs that need them.

- [nextjs-v16](.agents/skills/nextjs-v16/): `vercel-labs/agent-skills`, Next.js 16 breaking changes and current APIs
- [nextjs-app-router-patterns](.agents/skills/nextjs-app-router-patterns/): App Router, Server Components, streaming, data fetching
- [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/): `vercel-labs/agent-skills`, React and Next.js performance rules
- [typescript-core](.agents/skills/typescript-core/): TypeScript language and strictness conventions
- [zod](.agents/skills/zod/): schema validation at trust boundaries
- [tailwind](.agents/skills/tailwind/) and [shadcn](.agents/skills/shadcn/): Tailwind v4 and the shadcn/ui component conventions
- [vitest](.agents/skills/vitest/) and [playwright-cli](.agents/skills/playwright-cli/): the unit and end to end runners
- [accessibility-compliance](.agents/skills/accessibility-compliance/): WCAG 2.2 AA patterns and assistive technology support
- [error-handling-patterns](.agents/skills/error-handling-patterns/): error propagation and Result style returns
- [pnpm](.agents/skills/pnpm/): workspace and dependency conventions
- [github-actions](.agents/skills/github-actions/) and [deploy-to-vercel](.agents/skills/deploy-to-vercel/): CI and deployment
- [sentry-nextjs-sdk](.agents/skills/sentry-nextjs-sdk/): `getsentry/sentry-for-ai`, Sentry SDK setup, tracing, session replay and source maps for Next.js

Declined: lint-staged, eslint-prettier-config (`patricio0312rev/skills`), Cloudflare MCP
MCP servers: Sentry (`getsentry/sentry-mcp`, recommended, connect by OAuth at https://mcp.sentry.dev/mcp) · Supabase (configured in `.mcp.json` at https://mcp.supabase.com/mcp, needs an OAuth sign in before its tools work)

## Context files

- [src/ui/AGENTS.md](src/ui/AGENTS.md): the design tokens, the component set and the accessibility machinery; read `design.md` first
- [src/db/AGENTS.md](src/db/AGENTS.md): the database handle, the tenant scoping rule, and the Supabase pooler constraints
- [src/auth/AGENTS.md](src/auth/AGENTS.md): Clerk to local mirror sync, agency creation and the Clerk webhook
- [src/payments/AGENTS.md](src/payments/AGENTS.md): the Stripe subscription mirror, the webhook order and the reconcile
- [src/cron/AGENTS.md](src/cron/AGENTS.md): the one daily route, the sweep order and the runner's isolation rules
- [src/analytics/AGENTS.md](src/analytics/AGENTS.md): PostHog events, consent and the property rules, beside Sentry in `src/observability/`
- [src/invoices/AGENTS.md](src/invoices/AGENTS.md): the invoice lifecycle, gapless numbering, the issue email and the PDF
- [src/contacts/AGENTS.md](src/contacts/AGENTS.md): client contacts and the single use portal invitation token
- [src/storage/AGENTS.md](src/storage/AGENTS.md): the four operation R2 port, its fake and the R2 quirks
- [src/rate-limit/AGENTS.md](src/rate-limit/AGENTS.md): the three named ceilings and how they fail open

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
