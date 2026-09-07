# Verify: tenant scoping data access layer · spec 0003 · updated 2026-09-07

_Steps derived from spec 0003 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

_This feature has no screens. It is reached from Server Components and Server Actions, and feature 6 builds the first of those, so every step below is a command or a code level check rather than a click. Anything needing a real signed in Clerk session is marked **owed to feature 6** and cannot be run yet._

## Commands

- [x] `corepack pnpm typecheck` → `Types generated successfully`, then no type errors, exit 0. The type level cases in `src/db/tenant/accessor.types.test.ts` are part of this: each `@ts-expect-error` there fails the build if the error it expects stops happening → AC-1, AC-3, AC-4, AC-17
- [ ] `corepack pnpm lint` → no findings, exit 0, and no `any` or unchecked cast anywhere under `src/db/tenant/` → AC-17
- [x] `corepack pnpm test` → every file passes. With `DIRECT_URL` set, `src/db/tenant/tenancy.db.test.ts` runs against real PostgreSQL; without it, that one file is skipped and the rest still pass → AC-2, AC-4, AC-14
- [x] `corepack pnpm vitest run src/db/tenant/tenancy.db.test.ts` with `DIRECT_URL` pointed at a migrated database → 17 pass, and the database is unchanged afterwards (every case runs in a transaction that is rolled back) → AC-2, AC-16
- [x] `corepack pnpm vitest run tools/` → the exemption lists in `eslint.config.mjs` still match this spec: `src/db/tenant/**`, the two health checks and the handle's own test for `no-raw-db-import`; the three webhook and cron routes for `no-system-access-import` → AC-12, AC-13
- [ ] `grep -rn "from \"../client\"\|from \"@/db/client\"" src/ --include=*.ts` → exactly three hits: `src/db/tenant/executor.ts`, `src/app/api/health/db/route.ts`, `src/db/client.test.ts` → AC-13, key invariants
- [x] Push the branch → CI's `migrations-apply` job applies the migrations to its container, asserts the schema, then runs the tenancy suite against that same database in the same job → AC-16

## Code level checks

- [x] Write a scratch file at `src/clients/leak.ts` containing `import { db } from "@/db/client";` → `corepack pnpm lint` fails with `clienthq/no-raw-db-import` at error severity. Delete the file afterwards → AC-13
- [x] Write a scratch file at `src/clients/door.ts` containing `import { withSystemAccess } from "@/db/tenant/system";` → `corepack pnpm lint` fails with `clienthq/no-system-access-import`. Delete the file afterwards → AC-12
- [x] In a scratch file, call `tenantDb(staffCtx).findMany(users)` → typecheck fails, because `users` carries no `org_id` → AC-1
- [x] In a scratch file, call `tenantDb(contactCtx).findMany(memberships)` → typecheck fails, because `memberships` has no path to a client → AC-4
- [x] Read `src/db/tenant/action.ts` → the reserved `subscription` and `rateLimit` options are typed `never` and documented as belonging to features 9 and 19, so setting one today is a compile error rather than a silent no-op → AC-9

## Value sourcing

_One step per row of the spec's Value sourcing table: the source of each value, exercised at the edge that breaks if it is wrong._

- [x] Staff `orgId` and `userId`: seed two organizations, resolve with organization A's Clerk ids, and confirm the context carries A's local row ids and never B's → covered by `tenancy.db.test.ts`, "resolves agency staff from the Clerk claims"
- [x] Staff `role`: resolve with `orgRole` set to `org:admin` → `admin`; with `org:member` → `member`; with a role this build has never heard of (`org:billing_wizard`) → `member`, never `admin`. The unrecognised case is the one that matters → covered by `tenancy.db.test.ts` and `context.test.ts`
- [x] Contact `orgId`, `clientId`, `contactId`: resolve a contact and confirm all three come off the matched `client_contacts` row, with no cookie present at all → covered by `tenancy.db.test.ts`, "resolves a contact from their own row"
- [x] Which contact row is active: send a `clienthq_contact` cookie naming a row that belongs to a different user in a different organization → it is discarded and that user's own most recently accepted row wins. This is the forged cookie case → covered by `tenancy.db.test.ts`, "discards a cookie naming a contact row this user does not own" → AC-5
- [x] The `org_id` predicate value: run the accessor over all eight tables with a query logger attached and confirm every emitted statement contains `org_id`, including the writes → covered by `tenancy.db.test.ts`, "carries an org_id predicate on all eight tables" → AC-1
- [x] The client predicate: as a contact of client A in an organization serving A and B, ask for B's client, project, deliverable, invoice, line item and contact rows by exact id → all six come back `undefined` → AC-4
- [x] `insert` `org_id` and `id`: insert through the accessor and confirm the returned row carries the context's organization and a uuid v7 the application minted → AC-3
- [ ] `created_at` and `updated_at`: update a row twice and confirm `updated_at` moves while `created_at` does not, and that neither can be supplied in the patch → AC-3
- [x] Parsed input: call a wrapped action with a value the schema rejects → `code: "validation"` with `fieldErrors`, and the handler never runs → AC-8
- [x] `error.code`: confirm the union is exhaustively switchable and that no handler can return a free string; adding a code without handling it fails typecheck → AC-9
- [x] `unauthenticated` and `unavailable`: make context resolution throw `no_session` → `unauthenticated`; make it throw `no_mirror_row` → `unavailable`, with a log line → AC-9
- [x] `conflict`: have a handler throw a PostgreSQL `23505` carrying a constraint name → `code: "conflict"`, the constraint name appears in the log line and never in the message → AC-9
- [ ] Relational query key: load a relation through `with` (for example `clients` with `projects`) and confirm it returns typed children, with the table to key map derived from the schema module's export keys rather than a hand written list → AC-1
- [ ] `fieldErrors`: confirm they are present only for `code: "validation"` and absent from every other code → AC-8, AC-9
- [x] Revalidation targets: declare a path and a tag, run a successful action → each invoked exactly once; run one that returns a failure, and one whose handler throws → nothing invoked → AC-10
- [x] `requireAdmin` role source: give the context `role: "member"` and call an admin guarded action → `forbidden`, handler not called. Change `memberships.role` in the database to `admin` while leaving the claim at `member` → still `forbidden`, because the guard reads the claim → AC-11
- [x] Refusal log identifiers: trigger each refusal (no context, a cross tenant write miss, a failed role guard, a system access grant) and confirm exactly one JSON line each, carrying operation and reason always, user and organization when known, and no row contents. A `no_session` refusal carries neither identifier → AC-15
- [x] `withSystemAccess` reason: call it with a blank reason → it throws; call it with a real one → one `tenant.system_access` line naming it → AC-12

## Owed to feature 6 (no sign in flow exists yet)

- [ ] With a real Clerk session, load a Server Component that calls `tenantDb` several times → the resolution query runs once for the whole render. `context.test.ts` proves the resolver is wrapped in React `cache()`; this proves the request scope is real → AC-7
- [ ] Sign in with no Clerk organization selected → `no_active_org` rather than a generic failure, routed to the create or choose an agency screen → AC-6
- [ ] Sign in as a Clerk user with no local mirror row → `no_mirror_row`, routed to whatever feature 6 does about it → AC-6

## Acceptance-criteria coverage

- AC-1 covered by the typecheck steps, the `org_id` predicate step and the relational key step
- AC-2 covered by `corepack pnpm test` and the tenancy suite step
- AC-3 covered by the typecheck step, the insert step and the timestamps step
- AC-4 covered by the contact typecheck step and the client predicate step
- AC-5 covered by the contact sourcing step and the forged cookie step
- AC-6 covered by the tenancy suite and the three steps owed to feature 6
- AC-7 covered by `context.test.ts`, and fully by the first step owed to feature 6
- AC-8 covered by the parsed input step and the `fieldErrors` step
- AC-9 covered by the four error code steps
- AC-10 covered by the revalidation targets step
- AC-11 covered by the `requireAdmin` role source step
- AC-12 covered by the system access lint step and the reason step
- AC-13 covered by the raw handle lint step, the grep step and the exemption list step
- AC-14 covered by `corepack pnpm test` (the transactional accessor case in the tenancy suite)
- AC-15 covered by the refusal log identifiers step
- AC-16 covered by the push to CI step
- AC-17 covered by the typecheck and lint steps
