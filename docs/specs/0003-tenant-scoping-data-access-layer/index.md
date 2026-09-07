# 0003. Tenant scoping data access layer

**Date**: 2026-09-07
**Status**: In Progress

## Summary

This settles the one layer every read and write in the product goes through, so no screen or action can reach another agency's rows. A single accessor is generic over any table carrying an `org_id` column and always applies that filter, so a query missing it cannot be written; asking for a table that has no `org_id` is a compile error. Who you are is worked out once per request, from the Clerk session for agency staff or from your `client_contacts` row for a portal user, and that row is always checked against the database rather than taken from a URL or a form field. Writes go through a small wrapper that parses its input, checks the role and hands back a plain success or failure value. Two deliberately conspicuous exits exist inside the layer and nowhere else: one for complex queries that are still tenant scoped, one for the webhooks and cron that have no tenant at all.

## Requirements

**User stories**:

- As an agency, I want my rows unreachable from any other agency's session, so a bug in a screen I never use cannot expose my clients or invoices.
- As an engineer building any later slice, I want the safe query to be the easy query, so I am not relying on remembering a filter in every list, count and lookup I write.
- As a client contact, I want to see my own company's work and nothing else, even though the agency serves other clients from the same tables.
- As the person operating this, I want a test that actually proves cross tenant access fails, running on every push, rather than a claim in a document.

**Acceptance criteria** (the contract, each independently checkable):

- **AC-1**: Every accessor method, on all eight tenant scoped tables (`memberships`, `subscriptions`, `clients`, `client_contacts`, `projects`, `deliverables`, `invoices`, `invoice_line_items`), emits SQL containing an equality predicate on that table's `org_id` against the resolved context's organization. Passing a table with no `org_id` column to the accessor fails to compile.
- **AC-2**: With two organizations seeded with overlapping data in a real PostgreSQL, every read method called under organization A returns none of organization B's rows, and every write method targeting a B row affects zero rows and returns `not_found`. No response distinguishes an id that belongs to another organization from one that never existed.
- **AC-3**: Insert sets `org_id` from the resolved context and `id` from `newId()`. The insert value type omits both, so supplying either is a type error rather than a runtime check. The update patch type likewise omits `id`, `org_id` and `created_at`, so no write path can move a row into another organization.
- **AC-4**: A contact context narrows to its own client as well as its organization: on `clients` by `id`, on `client_contacts`, `projects` and `invoices` by `client_id`, and on `deliverables` and `invoice_line_items` through their parent row's client. `memberships` and `subscriptions` are unreachable from a contact context at compile time. A contact of client A retrieves nothing belonging to client B, whether B is in the same organization or another one.
- **AC-5**: Tenant context is resolved only from Clerk session claims (staff) or from a `client_contacts` row belonging to the signed in user (contact). No organization id or client id is ever read from request data. The active contact row is selected by the signed `clienthq_contact` cookie spec 0001 describes, and that value is re-verified on every request against a real `client_contacts` row for the signed in user: a cookie naming a row the user does not own is ignored, and resolution falls back to that user's most recently accepted row. The cookie chooses among rows the user already owns and can never supply an organization or a client. A signed in user with no contact row at all resolves to `no_contact`.
- **AC-6**: Resolution failures are distinct, typed and thrown, not returned: `no_session`, `no_active_org` (signed in with no Clerk organization selected), `no_mirror_row` (Clerk ids with no matching local `organizations` or `users` row) and `no_contact`. Each carries no row data.
- **AC-7**: Several accessor calls within one Server Component render or Server Action resolve the tenant context exactly once, through React `cache()`. An integration test asserting the number of resolution queries per request proves it. Route handlers are deliberately outside this path and use system access instead.
- **AC-8**: `withTenantAction` parses its declared Zod schema before the handler runs. Invalid input returns `{ ok: false, error: { code: "validation", fieldErrors } }` and the handler is never called.
- **AC-9**: Every action returns `{ ok: true, data }` or `{ ok: false, error: { code, message, fieldErrors? } }` where `code` is one of `validation`, `unauthenticated`, `not_found`, `forbidden`, `conflict`, `rate_limited`, `unavailable`. The union is exhaustively switchable in TypeScript. The wrapper maps the thrown resolution errors rather than letting an expired session reach the browser as a crash: `no_session`, `no_active_org` and `no_contact` become `unauthenticated`, and `no_mirror_row` becomes `unavailable` and is logged. A PostgreSQL unique violation (`23505`) or check violation (`23514`) becomes `conflict`, with the constraint name in the log line and never in the message shown to a person. Every other throw propagates rather than being converted into a Result.
- **AC-10**: Declared revalidation paths and tags are invoked exactly once, after a successful handler only. A handler returning a failure Result or throwing revalidates nothing.
- **AC-11**: `requireAdmin` and `requireStaff` read the role from the Clerk session claim and never from `memberships.role`. A member context calling an admin guarded action receives `forbidden` and the handler does not run.
- **AC-12**: `withSystemAccess` grants unscoped database access, requires a non empty reason string, emits one structured log line naming it, and is importable only from the webhook and cron route files. An import from anywhere else fails lint.
- **AC-13**: Importing `db` from `src/db/client.ts` fails lint everywhere except `src/db/tenant/`, `src/app/api/health/db/route.ts` and `scripts/db-check.ts`. `src/db/schema/**` is no longer exempt, and a test asserts the exemption list matches this spec.
- **AC-14**: An action declaring a transaction receives an accessor bound to that transaction which applies the same tenant predicates as the non transactional one. A throw inside the handler rolls back every write it made.
- **AC-15**: Every refusal (missing context, cross tenant miss on a write, a failed role guard, a system access grant) emits exactly one structured JSON log line carrying the operation and the reason always, plus the acting user id and organization id whenever they are known (a `no_session` refusal has neither), and no row contents.
- **AC-16**: CI applies the migrations to its throwaway PostgreSQL and then runs the tenancy integration suite against that database in the same job. Every cross tenant assertion failing fails the job.
- **AC-17**: `pnpm typecheck` and `pnpm lint` pass across the layer with no `any` and no unchecked cast, and the raw handle is imported in exactly one place inside it.

## Decision

**Chosen option**: Option 2: A scoped accessor derived from the schema, plus two named doors.

Build one accessor generic over any Drizzle table type carrying an `org_id` column, which always applies the tenant predicate and cannot yield an unfiltered builder; resolve the tenant context once per request from the Clerk session or the signed in user's `client_contacts` row; put every write behind a hand written `withTenantAction()` that declares its Zod schema and returns a Result; and confine the two unscoped exits, `unsafeTenantQuery` and `withSystemAccess`, to `src/db/tenant/`, with the existing ESLint rule narrowed to match.

**Implementation skills**: `drizzle` (`.agents/skills/drizzle/`) · `drizzle-migrations` (`.agents/skills/drizzle-migrations/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `clerk-orgs` (`clerk/skills`, `.agents/skills/clerk-orgs/`) · `clerk-nextjs-patterns` (`clerk/skills`, `.agents/skills/clerk-nextjs-patterns/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `zod` (`.agents/skills/zod/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `typescript-core` (`.agents/skills/typescript-core/`) · `vitest` (`.agents/skills/vitest/`)

## Feature design

**Data model sketch**: this feature adds no tables, no columns and no migration. It consumes the schema spec 0002 already built. The one new shape is `TenantContext`, held in memory for the length of a request.

`TenantContext` is a discriminated union on `kind`:

| Field | Type | Staff context | Contact context |
|---|---|---|---|
| `kind` | `"staff" \| "contact"` | `"staff"` | `"contact"` |
| `orgId` | uuid → `organizations.id` | from the `clerk_org_id` lookup | read off the matched `client_contacts` row |
| `clerkOrgId` | text | Clerk session claim | absent |
| `userId` | uuid → `users.id` | from the `clerk_user_id` lookup | `client_contacts.user_id` |
| `clerkUserId` | text | Clerk session claim | Clerk session claim |
| `role` | `"admin" \| "member"` | Clerk session organization role claim | absent |
| `clientId` | uuid → `clients.id` | absent | `client_contacts.client_id` |
| `contactId` | uuid → `client_contacts.id` | absent | `client_contacts.id` |

The contact row is chosen by the signed `clienthq_contact` cookie from spec 0001 and re-verified on every request against that user's own rows, falling back to the most recently accepted one. Setting and switching that cookie belongs to features 10 and 15; this layer only reads it and checks it.

Tenant scoped tables are the eight carrying `org_id`. `organizations` is the tenant root and is reached only through the resolver or system access. `users` and `processed_webhook_events` are not tenant scoped; `users` is read through Drizzle relations from an already scoped row (a membership, a contact, a deliverable's uploader), never on its own.

The client narrowing map, used only for a contact context, has three shapes and no fourth:

| Table | How the client predicate is formed |
|---|---|
| `clients` | `id = ctx.clientId` |
| `client_contacts`, `projects`, `invoices` | `client_id = ctx.clientId` |
| `deliverables` | `exists (select 1 from projects p where p.id = deliverables.project_id and p.client_id = ctx.clientId and p.org_id = ctx.orgId)` |
| `invoice_line_items` | `exists (select 1 from invoices i where i.id = invoice_line_items.invoice_id and i.client_id = ctx.clientId and i.org_id = ctx.orgId)` |
| `memberships`, `subscriptions` | no entry, so a contact context cannot address them and the call does not compile |

**API surface** (TypeScript, server only; there are no HTTP endpoints in this feature):

| Function | Shape | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `tenantContext()` | `() => Promise<TenantContext>`, wrapped in React `cache()` | none, reads the Clerk session and, for a portal request, the verified contact cookie | the resolved context | signed in | throws `no_session`, `no_active_org`, `no_mirror_row`, `no_contact` |
| `tenantDb(ctx, executor?)` | `(ctx: TenantContext, executor?: Executor) => StaffAccessor \| ContactAccessor` | the context (req), a transaction as executor (opt, defaults to the pooled handle) | a staff accessor or a contact accessor, chosen on `ctx.kind` | context required | compile error when a contact context addresses a table with no client path |
| `accessor.findMany(table, opts)` | `(table: TenantTable, opts?: { where?, orderBy?, limit?, offset?, with? }) => Promise<Row[]>` | table (req), opts (opt) | rows, tenant filtered | context | compile error on a non tenant table |
| `accessor.findFirst(table, opts)` | same, returns one row or `undefined` | table (req), opts (opt) | row or `undefined` | context | as above |
| `accessor.findById(table, id)` | `(table, id: string) => Promise<Row \| undefined>` | table (req), id: uuid (req) | row or `undefined` | context | `undefined` for a foreign tenant's id |
| `accessor.insert(table, values)` | `(table, values: InsertValues) => Promise<Row>` | values without `id` or `org_id` (req) | the inserted row | staff context | type error if `org_id` or `id` supplied |
| `accessor.update(table, id, patch)` | `(table, id, patch) => Promise<Row \| undefined>` | id: uuid (req), patch without `id`, `org_id` or `created_at` (req) | updated row or `undefined` | staff context | `undefined` when zero rows matched |
| `accessor.delete(table, id)` | `(table, id) => Promise<boolean>` | id: uuid (req) | whether a row was removed | staff context | `false` when zero rows matched |
| `withTenantAction(config)` | `({ input: ZodSchema, requireRole?, revalidate?, transaction?, handler }) => ServerAction` | input schema (req), handler (req), the rest (opt) | `Result<T, ActionError>` | staff context | `validation`, `unauthenticated`, `forbidden`, `not_found`, `conflict` |
| `requireAdmin(ctx)` / `requireStaff(ctx)` | `(ctx) => asserts` | context (req) | narrows the context type | context | `forbidden` |
| `unsafeTenantQuery(ctx, reason, fn)` | `(ctx, reason: string, fn: (db) => Promise<T>) => Promise<T>` | reason (req), query function (req) | whatever the query returns | context, layer only | none, the caller owns the predicate |
| `withSystemAccess(reason, fn)` | `(reason: string, fn: (db) => Promise<T>) => Promise<T>` | reason (req), function (req) | whatever it returns | none, webhook and cron files only | lint failure on import elsewhere |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `tenantContext` (staff) | `clerkUserId`, `clerkOrgId`, `role` | Clerk session claims, read through the single session module |
| `tenantContext` (staff) | `orgId`, `userId` | one query joining `organizations` and `users` on those two Clerk ids |
| `tenantContext` (staff) | `role` as `admin` or `member` | the Clerk organization role claim mapped in one place: the admin role maps to `admin`, every other value including an unrecognised one maps to `member` |
| `tenantContext` (contact) | `orgId`, `clientId`, `contactId`, `userId` | the single `client_contacts` row matched on the signed in user's `users.id` and the contact id in the verified cookie, falling back to that user's most recently accepted row by `accepted_at`; the row is the only source of the organization and the client |
| `tenantContext` (contact) | which contact row is active | the signed `clienthq_contact` cookie from spec 0001, always re-verified against the user's own rows and discarded when it does not match |
| every accessor call | the `org_id` predicate value | `ctx.orgId`, never a parameter |
| contact accessor call | the client predicate | `ctx.clientId` through the client narrowing map above |
| `insert` | `org_id` | `ctx.orgId` |
| `insert` | `id` | `newId()` in `src/lib/id.ts` |
| `insert` / `update` | `created_at`, `updated_at` | the existing `timestamps()` helper and Drizzle's `$onUpdate` |
| `withTenantAction` | parsed input | the declared Zod schema, the only parse at this boundary |
| `withTenantAction` | `error.code` | the closed union in AC-9, chosen by the layer, never a free string from a handler |
| `withTenantAction` | `unauthenticated` and `unavailable` codes | the thrown resolution error kind, mapped in one place in the wrapper |
| `withTenantAction` | the `conflict` code | the PostgreSQL error code on the caught exception (`23505`, `23514`); the constraint name goes to the log, never to the message |
| accessor relation loading | which `db.query` entry a table maps to | derived at module load from the schema module's own export keys, so no list is hand maintained |
| `withTenantAction` | `error.fieldErrors` | Zod's flattened field errors, present only for `code: "validation"` |
| `withTenantAction` | the paths and tags to revalidate | declared in the action's config, never inferred |
| `requireAdmin` | the role compared | `ctx.role`, sourced from the Clerk claim, never `memberships.role` |
| refusal log line | user id, organization id, operation, reason | the resolved context plus the call site's own name |
| `withSystemAccess` | the reason recorded | the required argument at the call site |

**Key invariants**:

- Every SQL statement this layer emits against a tenant scoped table carries an `org_id` equality predicate. There is no code path that omits it, including inside a transaction.
- A contact context additionally carries a client predicate on every table it can address, and cannot address a table that has no path to a client.
- `src/db/client.ts` is imported in exactly one file inside `src/db/tenant/`, plus the two health checks documented in `src/db/AGENTS.md`.
- Tenant identity never originates from request supplied data. A route parameter may select among rows the signed in user already owns; it may never supply an organization id or become one.
- The authoritative role is the Clerk session claim. `memberships.role` is a display mirror and no decision reads it.
- Resolution never writes. Creating missing mirror rows belongs to feature 6.
- No write path can change a row's `org_id` or `id`. Both are absent from the insert value type and from the update patch type, so moving a row into another organization does not compile.
- The accessor is constructed over an executor, either the pooled handle or an open transaction, so a transactional accessor carries predicates identical to the ordinary one.
- `tenantContext()` belongs to Server Components and Server Actions. Route handlers do not resolve a tenant; the webhook and cron routes use system access and the health checks touch no tenant table.
- Drizzle relation loading through `with` is allowed, because every tenant table's foreign keys point inside the same organization, so a scoped root row cannot pull a foreign tenant's children into the result. The mapping from a table to its relational query key is derived from the schema module's export keys, not maintained by hand.

**State transitions**: none. This feature owns no stateful entity.

**Security model**:

| Actor | Reaches | Through |
|---|---|---|
| Agency admin | every tenant scoped table for their own organization, read and write, plus admin guarded actions | staff context, `requireAdmin` where a later feature demands it |
| Agency member | the same rows, read and write, minus admin guarded actions | staff context, refused with `forbidden` at the guard |
| Client contact | their own client's rows only, read only, on the six tables with a path to a client | contact context, narrowed on organization and client, writes structurally unavailable |
| Webhook and cron routes | everything, unscoped | `withSystemAccess` with a recorded reason, importable only from those files |
| Everyone else | nothing | resolution throws before any query runs |

No new regulated data is introduced; the personal data in scope is the same names and emails spec 0002 already models, so no new compliance scope is triggered. The refusal log deliberately records identifiers and never row contents.

**Configuration required**:

- `CLERK_SECRET_KEY`: the server side Clerk key the session module needs to read session claims. Added to the Zod schema in `src/lib/env.ts` and read through `env()`, per the project rule.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: required by the Clerk SDK at import time even though this feature renders no Clerk UI. Same schema, marked as the public one.
- No third party account setup beyond a Clerk application, which feature 6 configures fully. This feature needs the keys to exist, not the sign in flow to work.

**Critical test scenarios** (each maps to an acceptance criterion above):

- Happy path: a staff context reads and writes its own organization's clients through the accessor, and the emitted SQL carries the `org_id` predicate on every statement, verifies **AC-1**, **AC-3**.
- Failure case: organization A's context asks for organization B's client, project, invoice and line item by exact id, and receives nothing on reads and zero affected rows on writes, verifies **AC-2**.
- Failure case: a contact of client A, in an organization serving clients A and B, asks for B's projects, invoices, deliverables and line items and receives nothing, verifies **AC-4**.
- Failure case: a route names a client the signed in user has no contact row for, and resolution refuses rather than returning that client's data, verifies **AC-5**.
- Failure case: a handler throws partway through a declared transaction and none of its writes survive, verifies **AC-14**.
- Failure case: an action returns a failure Result and nothing is revalidated, verifies **AC-10**.
- Failure case: an update attempting to move a row into another organization does not compile, proven by a type level test, verifies **AC-3**.
- Failure case: a portal request arrives carrying a contact cookie naming a row the signed in user does not own, and it is discarded in favour of their own most recently accepted row, verifies **AC-5**.
- Failure case: an expired session calling a wrapped action receives `unauthenticated` rather than a crash, and a duplicate write violating a unique constraint receives `conflict`, verifies **AC-9**.
- Auth/permission: a member context calls an admin guarded action and receives `forbidden` without the handler running, verifies **AC-11**.
- Auth/permission: a signed in user with no active Clerk organization gets `no_active_org` rather than a generic failure, verifies **AC-6**.
- Enforcement: a fixture file importing `db` from `src/db/client.ts` outside the allowed paths fails lint, and a fixture importing `withSystemAccess` outside the webhook and cron files fails lint, verifies **AC-12**, **AC-13**.

## Build plan

Ordered as a Tracer Bullet: milestone 1 is one thin thread through every layer of this feature (a real Clerk claim, a real context, a real scoped query, a real write, a real isolation test on real PostgreSQL) using a single table. Everything after it thickens that thread rather than adding a new one.

**Milestone 1: one thread, end to end, on `clients`**

1. Add `@clerk/nextjs` and add `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the Zod schema in `src/lib/env.ts`, read only through `env()`. No provider, no middleware, no routes, satisfies **AC-17**
2. Create `src/db/tenant/session.ts` as the only file in the project importing Clerk's `auth()`, exposing the raw claims (user id, organization id, organization role) and nothing else, so tests stub one module, satisfies **AC-5**
3. Create `src/db/tenant/errors.ts` with the thrown resolution error kinds (`no_session`, `no_active_org`, `no_mirror_row`, `no_contact`) and the `ActionError` code union including `unauthenticated`, satisfies **AC-6**, **AC-9**
4. Create `src/db/tenant/context.ts` with the staff resolver: read claims, map the Clerk role to `admin` or `member`, then one query joining `organizations` and `users` on the two Clerk ids. Throw the right typed error on each missing piece. Wrap in React `cache()`, satisfies **AC-5**, **AC-6**, **AC-7**
5. Create `src/db/tenant/accessor.ts` with `tenantDb(ctx, executor?)` supporting `findMany`, `findFirst` and `insert` on `clients` only, applying the `org_id` predicate and setting `org_id` and `id` on insert. Take the executor as a parameter from the start, defaulting to the pooled handle, so milestone 4 adds transactions without reshaping the type, satisfies **AC-1**, **AC-3**
6. Create `src/db/tenant/action.ts` with a minimal `withTenantAction({ input, handler })`: resolve context, parse with Zod, run, return the Result union. Map the thrown resolution errors onto `unauthenticated` and `unavailable`, and PostgreSQL `23505` and `23514` onto `conflict`, in one place, satisfies **AC-8**, **AC-9**
7. Write the first integration test against a real PostgreSQL: two organizations, overlapping clients, and assertions that A reads and writes none of B's rows, satisfies **AC-2**

**Milestone 2: generalise the accessor over every tenant table**

8. Make the accessor generic over any Drizzle table type carrying `org_id`, so a table without one is a compile error, and cover all eight tenant scoped tables, satisfies **AC-1**
9. Complete the method set with `findById`, `update` and `delete`, returning `undefined` or `false` when zero rows match rather than throwing. The update patch type omits `id`, `org_id` and `created_at`, so no write can move a row into another organization, satisfies **AC-1**, **AC-2**, **AC-3**
10. Add `unsafeTenantQuery(ctx, reason, fn)` in the layer. Derive the table to relational query key map from the schema module's own export keys at load, so `with` works without a hand maintained list, and document in code that relation loading is allowed because foreign keys stay inside the organization, satisfies **AC-1**
11. Extend the integration suite across all eight tables for both reads and writes, satisfies **AC-2**

**Milestone 3: the second audience, client contacts**

12. Add the contact resolver: read the signed `clienthq_contact` cookie, re-verify it against a `client_contacts` row owned by the signed in user, fall back to that user's most recently accepted row when it does not match or is absent, read the organization and client off the row that wins, and refuse with `no_contact` when the user owns none, satisfies **AC-5**, **AC-6**
13. Split the accessor type on `ctx.kind`: a staff accessor over all eight tables with writes, and a contact accessor over the six tables with a client path, reads only. Add the client narrowing map with its three predicate shapes and wire it into every contact accessor method, so `memberships` and `subscriptions` do not compile from a contact context, satisfies **AC-4**
14. Make writes structurally unavailable to a contact context, satisfies **AC-4**
15. Extend the integration suite with the two client organization case and the forged route client id case, satisfies **AC-4**, **AC-5**

**Milestone 4: the full write path**

16. Add `requireAdmin` and `requireStaff` reading `ctx.role` from the Clerk claim, and the `requireRole` option on the wrapper that returns `forbidden` before the handler runs, satisfies **AC-11**
17. Add declared revalidation, invoked once and only after a successful handler, satisfies **AC-10**
18. Add the opt in transaction: the wrapper opens one and passes it as the accessor's executor, so the handler gets identical predicates, and a throw rolls the whole thing back, satisfies **AC-14**
19. Name the reserved wrapper options for the subscription gate (feature 9) and the rate limiter (feature 19) in the options type, documented as unimplemented, satisfies **AC-9**
20. Add `src/db/tenant/log.ts`, one structured JSON line per refusal carrying identifiers and no row contents, and call it from every refusal path, satisfies **AC-15**

**Milestone 5: the fence and the proof on every push**

21. Add `withSystemAccess(reason, fn)` in `src/db/tenant/system.ts`, requiring a non empty reason and logging each grant, satisfies **AC-12**
22. Narrow the ESLint exemption from `src/db/**` to `src/db/tenant/**` plus the two health checks, add a rule restricting imports of `src/db/tenant/system.ts` to the webhook and cron route paths, and extend `tools/eslint/tenant-isolation-config.test.mts` to assert both lists match this spec, satisfies **AC-12**, **AC-13**
23. Extend the existing CI job that starts a throwaway PostgreSQL: apply migrations, then run the tenancy integration suite against that database in the same job, satisfies **AC-16**
24. Confirm `pnpm typecheck` and `pnpm lint` pass across the layer with no `any` and no unchecked cast, satisfies **AC-17**

## Consequences

**Positive**:

- The unsafe query stops being expressible in ordinary application code. Both the tenant filter and, for the portal, the client filter are applied by the same code path that runs the query.
- Coverage is derived from the `org_id` column, so a table added in a later slice is protected without anyone remembering to protect it, and a table without `org_id` cannot be passed at all.
- The whole boundary is four greppable names (`tenantDb`, `withTenantAction`, `unsafeTenantQuery`, `withSystemAccess`) in one directory, so a reviewer can see all of it at once instead of reading every query.
- The cross tenant claim is proven by a test against real SQL on every push, not asserted in a document.
- Every later feature inherits one shape for actions: declared input, parsed once, a Result with a closed error code set the UI can switch on exhaustively.

**Negative / tradeoffs**:

- Enforcement is still application level, so the database will hand over any row asked for. A change that widens the ESLint exemption, or a careless query behind the escape hatch, reopens the hole. Row level security is the fix and it is deferred, with its trigger named below.
- The generic accessor is the fiddliest typing in the project, and it is generic along three axes at once: the table, the executor (pooled handle or transaction), and the context kind. Expect real time spent on Drizzle's types, and a compile error there is expensive to unpick. The Follow-up names the fallback if it fights back.
- The accessor's method set is a fixed surface. The first query shape it cannot express sends someone to the escape hatch, and the escape hatch is where a future leak will come from.
- Clerk arrives now rather than at feature 6, so the project carries an authentication dependency and two environment variables before there is any sign in flow to use them.
- The two door design means webhook and cron authors have to reach for a named function rather than the obvious import, which is friction on purpose but still friction.

**Neutral**:

- No migration, no schema change. This feature consumes spec 0002's tables as they are.
- Reads are plain statements today. The single choke point exists so that turning on row level security later changes one function plus a migration rather than every call site, but it also means reads do not currently pay a transaction cost.
- Pagination is not built. `limit` and `offset` are on the accessor, but no cursor helper exists, so the first large list screen has to decide that.
- Archived and soft deleted rows come back unless a caller filters them. That is deliberate, and every list screen has to be explicit about it.

## Follow-up

- [ ] Decide row level security before a second real agency's data lives in the database. That is the trigger: not a date, and not launch, but the first moment two tenants share the table. The work is a dedicated application database role that does not bypass policies, a policy migration across the eight tenant tables, and changing the layer's single choke point to open a transaction and set the per request setting. The scope already carries this in Deferred, and this spec is what it was waiting on.
- [ ] If the generic accessor types prove intractable during milestone 2, fall back to generating one concretely typed accessor per tenant table from the schema, the way `drizzle-zod` schemas are already generated in `src/db/schema/zod.ts`. Same coverage guarantee, no generic type risk, at the cost of a generation step. Decide this in the build rather than fighting the types for a day.
- [ ] Setting and switching the `clienthq_contact` cookie belongs to feature 10 (invitation acceptance sets it) and feature 15 (the portal offers a switcher when a user has several contact rows). This layer only reads and verifies it, so both features must exist before a multi client contact can move between clients.
- [ ] Add a cursor based pagination helper to the accessor when the first list screen needs it, most likely feature 7 or feature 13.
- [ ] Revisit the escape hatch after slice 6. If `unsafeTenantQuery` has more than a handful of call sites, the accessor is missing a shape and should grow one rather than the hatch growing users.
- [ ] The conventions in this spec (the four names, the two doors, the resolution rule) belong in `src/db/AGENTS.md` once the layer exists, so later features read them without opening this spec. That file is owned by `/sync`, not by this spec.
- [ ] Feature 6 owns `middleware.ts`, the Clerk provider, the route groups and the on demand upsert of missing mirror rows. This layer throws `no_mirror_row` and `no_active_org` specifically so feature 6 can route each case correctly.

## Rationale

Reasoning, the options weighed and the forces behind them: see [rationale.md](rationale.md).
