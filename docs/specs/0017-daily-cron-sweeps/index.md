# 0017. Daily cron sweeps

**Date**: 2026-09-17
**Status**: In Progress

## Summary

One scheduled route, `/api/cron/daily`, runs once a night and does every piece of housekeeping the product needs in a fixed order: it marks invoices overdue, clears uploads that never finished, tidies expired invitation tokens, checks the local copies of Stripe subscriptions and Clerk agencies against the providers and repairs what disagrees, and prunes old bookkeeping rows. Each sweep runs on its own, so one breaking never stops the others, and every run leaves a row in a new `cron_runs` table saying what it did, because the hosting plan keeps logs for about an hour. The route accepts nothing without the shared secret Vercel sends, and the run row's insert is also what keeps the free Supabase database from being paused for inactivity.

## Requirements

**User stories**:
- As an agency staff member, I want an unpaid invoice to become `overdue` on its own the night after its due date, so the list and the client portal say the truth without anyone clicking.
- As an agency staff member, I want an upload that died halfway to disappear along with its stored bytes, so storage does not fill with files nobody can see.
- As a paying agency, I want a missed Stripe or Clerk webhook to be repaired within a day, so a stale local copy never locks me out or shows a deleted teammate.
- As the operator, I want to know from one table whether last night's run happened and what each sweep did, and to be told when one failed.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `GET /api/cron/daily` runs only when the request carries `Authorization: Bearer <CRON_SECRET>` and the token equals the configured secret, compared in constant time. A missing header, a wrong token, or a different scheme answers `401` with an empty JSON body, reads and writes nothing, and leaves one structured log line with outcome `unauthorized`. `CRON_SECRET` is required in every environment (`development`, `test`, `production`) and at least 16 characters, so an unset secret fails the environment parse rather than opening the route.
- **AC-2**: Every authorized run first inserts one `cron_runs` row (`started_at` from the database clock, `finished_at`, `outcome` and `report` null), then runs the sweeps, then updates that same row with `finished_at`, `outcome` and the full per sweep `report`. That insert is the keep alive: no separate heartbeat query exists. The route answers `200` when every sweep is `ok` or `skipped` and `500` when at least one is `failed`, with the same JSON body in both cases: `{ runId, outcome, sweeps: [{ name, outcome, counts, durationMs, error? }] }`.
- **AC-3**: The sweeps run in this fixed order, one after another: `overdue_invoices`, `abandoned_uploads`, `expired_invites`, `stripe_reconcile`, `clerk_reconcile`, `retention_prune`. A sweep that throws is recorded as `failed` with the error's message, and the next sweep still runs. A sweep's outcome is `ok`, `skipped` or `failed`; the run's outcome is `failed` exactly when any sweep is `failed`, otherwise `ok`. Each sweep writes exactly one structured log line (`event: "cron.sweep"`) and the run writes one (`event: "cron.run"`), in the shape of `src/auth/webhook-log.ts`.
- **AC-4**: `overdue_invoices` moves every invoice with `status = 'sent'` and `due_date < today` to `overdue` and writes exactly one `invoice_events` row per moved invoice (`kind = 'overdue'`, `from_status = 'sent'`, `to_status = 'overdue'`, `actor_user_id` null), both in one transaction. `today` is the UTC calendar day computed by the application through the same helper the Past due badge uses (spec 0012, AC-12), so the badge and the sweep can never disagree. A `sent` invoice due today or later, and an invoice in any other status, is untouched. A second run the same day moves nothing and writes no event. The sweep asserts `canTransition("sent", "overdue")` from `src/invoices/status.ts` before writing and fails without writing if it is ever false. When at least one invoice moved, the sweep revalidates the same paths every invoice write revalidates (`INVOICE_REVALIDATE` in `src/invoices/revalidate.ts`) plus `/portal/invoices` and `/portal/invoices/[id]`.
- **AC-5**: `abandoned_uploads` takes `deliverables` rows with `status = 'pending'` and `created_at < now() - interval '24 hours'`, oldest first, at most 200 per run. For each row it deletes the R2 object first (a delete of a key that no longer exists counts as deleted) and then the row. A storage failure leaves the row in place, counts that row as failed, and the sweep moves on to the next row; the sweep's outcome is `failed` when any row failed. `counts.truncated` is true when 200 rows were taken and at least one more qualified. When storage is not configured (`isStorageConfigured()` is false) the sweep deletes nothing and reports `skipped` with reason `storage not configured`, and the run stays `ok`.
- **AC-6**: `expired_invites` sets `invite_token_hash` and `invite_expires_at` to null on every `client_contacts` row where `invite_token_hash is not null` and `invite_expires_at < now() - interval '30 days'`, in one statement, and reports the count. No other column changes; an accepted or a currently valid invitation is untouched.
- **AC-7**: `stripe_reconcile` lists every subscription in the Stripe account (all statuses, 100 per page, following pagination to the end) into memory, and writes nothing until that listing is complete: a listing failure applies nothing and ends the sweep `failed`. Once complete, it resolves each subscription's agency exactly as the webhook does (the `subscriptions` row already holding that customer id, else the `org_id` in the subscription's metadata, and the organization must exist locally), groups the resolved subscriptions by agency, and keeps one per agency: the greatest Stripe `created`, and on a tie the one that is not `canceled`. Each kept subscription is applied in its own transaction through `applySubscriptionState`, the one shared function the webhook also uses, which takes the row lock and refuses to replace a stored `stripe_customer_id` with a different one (spec 0007, AC-27). A subscription that resolves to no agency is counted `unresolved` and logged with its Stripe id; a refused customer change is counted `customer_conflict` and logged with both customer ids; a subscription dropped by the newest per agency rule is counted `superseded`; none of the three writes anything and none makes the sweep `failed`. A local `subscriptions` row whose `stripe_subscription_id` did not appear in the listing is counted `unlisted` and logged, never changed. A failure applying one subscription is counted `errors`, the walk continues, and the sweep ends `failed`. Nothing is written to `processed_webhook_events`.
- **AC-8**: `clerk_reconcile` runs three passes and never removes anything on the strength of an incomplete listing; each pass applies the upserts from the pages it saw even when a later page fails. Organizations: it lists Clerk organizations to the end and upserts each with `upsertOrganizationRow` (name and `updated_at`; `slug` on insert only; `deleted_at` never touched); a `"deleted"` return (the organization is locally soft deleted) is counted `skipped_deleted`, is not a failure, and excludes that organization from the membership pass; then, only if that listing completed, every local organization with `deleted_at` null whose `clerk_org_id` is absent from it is soft deleted with `softDeleteOrganization` and `deleteMembershipRows`, logging the organization id and its local subscription status exactly as the webhook does (spec 0015, AC-6). Memberships: for each listed, live Clerk organization it lists that organization's memberships to the end and runs `ensureUserRow` then `upsertMembershipRow` for each, in the webhook's order (here a listed member with no local row does get one, exactly as a `organizationMembership.created` event would create it; a `MirrorUserDeleted` throw is caught and counted `skipped_scrubbed`); then, only if that organization's membership listing completed, every local `memberships` row of that organization whose user is absent from it is deleted. Users: it first reads every local user with `deleted_at` null (`id`, `clerk_user_id`) in one query, then lists Clerk users to the end; a listed user present in that local set is updated through `ensureUserRow`, a listed user absent from it is ignored and no row is created; then, only if that listing completed, every local user in the set whose `clerk_user_id` is absent from the listing is scrubbed the spec 0015 AC-9 way: `scrubUser()` fields and `deleted_at`, then `deleteMembershipRows`, then `unbindContactsOfUser`, in that order. Each object's write runs in its own transaction; a failure on one object is counted `errors`, the pass continues, and the sweep ends `failed`. A listing failure ends the sweep `failed` with the writes already made kept.
- **AC-9**: `retention_prune` deletes `processed_webhook_events` rows with `processed_at < now() - interval '90 days'` and `cron_runs` rows with `started_at < now() - interval '90 days'`, reporting both counts. The current run's row is never deleted.
- **AC-10**: The `report` column, the response body and every log line carry counts, durations, uuids, provider ids and error messages only. They never carry an email address, a person's name, an image URL, a payload or a row.
- **AC-11**: The route file `src/app/api/cron/daily/route.ts` exports `dynamic = "force-dynamic"`, `runtime = "nodejs"` and `maxDuration = 300`, is the only file in this feature that imports `withSystemAccess`, and passes the handle into a runner that takes it as an argument; every sweep takes its `Database` handle the same way, so `tools/eslint/tenant-isolation-config.test.mts` stays green with no change to the exemption list. `vercel.json` gains `crons: [{ path: "/api/cron/daily", schedule: "0 3 * * *" }]`.
- **AC-12**: Two runs that overlap (a manual call while the schedule fires) leave two `cron_runs` rows and the same end state as one run: no invoice gets a second `overdue` event, no delete of an already removed object or row fails the sweep, and no provider state is applied twice in a way that changes the row. No lock is taken.

## Decision

**Chosen option**: Option 2: One guarded route running isolated sweeps with a durable run record and both provider reconciles.

One `GET /api/cron/daily` route, fired by Vercel Cron at 03:00 UTC, runs six sweeps in sequence inside `withSystemAccess`, each sweep an isolated function taking the database handle, with a `cron_runs` row per run and a per sweep report.

**Implementation skills**: `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `supabase-postgres-best-practices` (`.agents/skills/supabase-postgres-best-practices/`) · `stripe-best-practices` (`.agents/skills/stripe-best-practices/`) · `clerk-backend-api` (`.agents/skills/clerk-backend-api/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `vitest` (`.agents/skills/vitest/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

One new system table (no `org_id`, like `processed_webhook_events`), in `src/db/schema/cron.ts`, registered nowhere in the tenant table registry because no tenant ever reads it.

| Table | Column | Type | Null | Notes |
|---|---|---|---|---|
| `cron_runs` | `id` | uuid, pk | no | `newId()` |
| | `started_at` | timestamptz | no | `now()` from the database clock at insert |
| | `finished_at` | timestamptz | yes | null until the run ends; a platform timeout leaves it null on purpose |
| | `outcome` | text | yes | `ok` or `failed`, CHECKed; null while running |
| | `report` | jsonb | yes | the `sweeps` array from AC-2, written at finish |

Index: `cron_runs_started_at_idx` on `started_at` (the prune and "what did the last run do" both order by it). No foreign keys, no relations. Retention 90 days (AC-9). The `drizzle-zod` schemas for the table are added beside the others in `src/db/schema/zod.ts`, and `db-schema-assert` gains the table.

No other table changes. `invoice_events` already has the `overdue` kind and a nullable actor (spec 0012), `deliverables` already has `status` and `created_at` (spec 0011), `client_contacts` already has the two invite columns (spec 0009), `subscriptions` and the three Clerk mirror tables are unchanged (specs 0007, 0015).

**State transitions**:

- A run: `running` (row inserted, `finished_at` null) → `ok` or `failed` (row updated). A run that dies stays `running` forever, which is the evidence of a timeout; nothing moves it on.
- A sweep, within a run: `ok` · `skipped` (a precondition such as storage missing) · `failed` (threw, or at least one row or object failed). Recorded in `report`, never in its own row.
- Invoices: only `sent → overdue`, the transition spec 0012 defined and reserved for this sweep.
- Deliverables: `pending → gone`, the sweep branch of spec 0011's diagram.
- Organizations and users: `live → soft deleted` (spec 0015's one irreversible move), now taken by the reconcile as well as the webhook. Never reversed.

**Code layout** (settled here so `/develop` does not invent it):

| File | Holds |
|---|---|
| `src/app/api/cron/daily/route.ts` | The secret check, `withSystemAccess("daily cron: scheduled sweep across every agency, no session")`, the three Next exports (AC-11), the JSON answer. Short, like the webhook routes. |
| `src/cron/runner.ts` | `runDailySweeps({ db, sweeps, now })`: inserts the run row, runs each sweep in its own `try`/`catch` with a timer, builds the report, updates the row, returns `{ runId, outcome, sweeps }`. Pure apart from the two row writes. |
| `src/cron/sweep.ts` | The `Sweep` type: `{ name: SweepName, run: (input: SweepInput) => Promise<SweepReport> }` with `SweepInput = { db: Database, todayUtc: string, now: Date }`, `SweepReport = { outcome, counts: Record<string, number \| boolean>, reason?: string }`, and the `SWEEP_ORDER` constant (AC-3). |
| `src/cron/log.ts` | `logCronRun` and `logCronSweep`, the two structured lines (AC-3, AC-10), shaped like `src/auth/webhook-log.ts`. |
| `src/cron/secret.ts` | `isAuthorized(header: string \| null, secret: string): boolean`, a pure constant time comparison (sha256 both sides, then `crypto.timingSafeEqual`, so length never leaks). |
| `src/cron/retention-sweep.ts` | `retention_prune` (AC-9). Lives here because it spans two features' tables. |
| `src/cron/daily.ts` | The wired list: the six sweeps in order with their live gateways, what the route hands to the runner. |
| `src/invoices/overdue-sweep.ts` | `overdue_invoices` (AC-4), beside the status module it asserts against. |
| `src/deliverables/abandoned-sweep.ts` | `abandoned_uploads` (AC-5), taking the storage port as an argument so the fake serves the tests. |
| `src/contacts/expired-invites-sweep.ts` | `expired_invites` (AC-6). |
| `src/payments/subscription-mirror.ts` | `applySubscriptionState(tx, orgId, subscription): Promise<"applied" \| "customer_id_conflict">`: the `select ... for update` on the agency's row, the stored customer id check (spec 0007, AC-27), and the upsert that is today's private `applyState` in `src/payments/webhook.ts`, moved here together with `resolveOrgId` and exported. The webhook calls it and turns `"customer_id_conflict"` into its existing `WebhookRefusal`; the reconcile counts it. The lock, the guard and the write travel together so the two writers cannot drift. |
| `src/payments/reconcile.ts` | `stripe_reconcile` (AC-7) over a `StripeListGateway = { listSubscriptions: () => AsyncIterable<RetrievedSubscription> }`, with `liveStripeListGateway()` beside `stripe.ts` and a fake for tests. `retrievedSubscription` in `src/payments/events.ts` gains `created: stripeTimestamp` for the newest per agency rule. |
| `src/auth/reconcile.ts` | `clerk_reconcile` (AC-8) over a `ClerkListGateway = { listOrganizations, listOrganizationMemberships(clerkOrgId), listUsers }`, each an `AsyncIterable` of the `Mirror*` shapes `src/db/tenant/provisioning.ts` already defines (`MirrorOrganization`, `{ clerkUserId, role }`, `MirrorUser`), with `liveClerkListGateway()` in `src/auth/clerk.ts` and a fake for tests. |
| `src/auth/clerk.ts` (existing) | Two new pure mappers, `toMirrorOrganization(raw)` and `toMirrorUser(raw)` (primary email by `primaryEmailAddressId`, name through the existing `displayName`), extracted from the bodies of `clerkOrganization` and `clerkUser`, which then call them. The list gateway maps each listed object with these and never fetches an object by id a second time. |

**Report vocabulary** (the `counts` keys each sweep may write, fixed here and typed in `src/cron/sweep.ts`; a sweep writes every key it owns on every run, zero when nothing happened, so a reader never has to guess whether a missing key means zero):

| Sweep | Keys | Meaning |
|---|---|---|
| every sweep | `errors` | objects or rows whose write threw; any value above zero makes the sweep `failed` |
| `overdue_invoices` | `moved` | invoices moved to `overdue`, equal to the events written |
| `abandoned_uploads` | `removed`, `failed`, `truncated` | rows removed with their object; rows left because the object delete failed; `truncated` is a boolean, true when a 201st qualifying row existed |
| `expired_invites` | `cleared` | rows whose two invite columns were nulled |
| `stripe_reconcile` | `listed`, `applied`, `unresolved`, `customer_conflict`, `superseded`, `unlisted` | subscriptions the complete listing produced; rows written; no agency; refused customer change; dropped by the newest per agency rule; local rows absent from the listing |
| `clerk_reconcile` | `organizations_upserted`, `organizations_soft_deleted`, `skipped_deleted`, `memberships_upserted`, `memberships_removed`, `skipped_scrubbed`, `users_updated`, `users_scrubbed`, `listing_incomplete` | as named; `listing_incomplete` is a boolean, true when any of the three listings failed before its end |
| `retention_prune` | `webhook_events_pruned`, `cron_runs_pruned` | rows deleted from each table |

A `skipped` sweep writes `reason` and no counts. The `error` field on a `failed` sweep is the thrown error's message, or the first per object error message when only counts failed.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/cron/daily` | GET | `Authorization: Bearer <CRON_SECRET>` header (req) | `{ runId, outcome, sweeps[] }`, `200` all sweeps ok or skipped, `500` any failed | shared secret, constant time compare | `401` empty JSON body, nothing run |
| `runDailySweeps` | function | `db: Database`, `sweeps: readonly Sweep[]`, `now: Date` | `{ runId, outcome, sweeps }` | none (called by the route only) | never throws for a sweep failure; throws only if the run row itself cannot be written |
| each `Sweep.run` | function | `{ db, todayUtc, now }` plus its own gateway or port bound at wiring | `SweepReport` | none | a throw is caught by the runner and recorded as `failed` |

Manual trigger, local or against a deployment: `curl -i -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`. Vercel sends the same header on its own for the scheduled call.

**Value sourcing** (every value each action produces, computes, or displays names where it comes from):
| Action | Value produced / displayed | Source |
|---|---|---|
| Route | whether the caller is authorized | the `Authorization` header versus `env().CRON_SECRET`, through `isAuthorized` (AC-1) |
| Route | the HTTP status | derived from the runner's `outcome`: `ok` → 200, `failed` → 500 (AC-2) |
| Runner | `runId` | `newId()` at the run row insert |
| Runner | `started_at`, `finished_at` | the database clock, `now()` in the insert and the update (AC-2) |
| Runner | `todayUtc` handed to every sweep | the application clock (`new Date()` at run start) formatted as the UTC `YYYY-MM-DD`, by the same helper the invoice pages use for the Past due badge (spec 0012); one value per run so every sweep agrees on the day |
| Runner | `durationMs` per sweep | `performance.now()` around the sweep call |
| Runner | the run `outcome` | `failed` if any sweep report is `failed`, else `ok` (AC-3) |
| Overdue sweep | which invoices move | `invoices.status = 'sent' and invoices.due_date < todayUtc` (specs 0002, 0012) |
| Overdue sweep | the event row's fields | `kind = 'overdue'`, `from_status = 'sent'`, `to_status = 'overdue'`, `actor_user_id = null`, `invoice_id` and `org_id` from the `returning` of the update (spec 0012, AC-15) |
| Overdue sweep | the paths to revalidate | `INVOICE_REVALIDATE.paths` plus `/portal/invoices` and `/portal/invoices/[id]` (page type) |
| Abandoned sweep | which rows qualify | `deliverables.status = 'pending' and created_at < now() - interval '24 hours'`, ordered by `created_at`, `limit 201` (the extra row only sets `truncated`) (spec 0011) |
| Abandoned sweep | the object key | `deliverables.r2_key` (spec 0011) |
| Abandoned sweep | whether to skip | `isStorageConfigured()` from `src/storage` |
| Invite tidy | which rows qualify | `client_contacts.invite_token_hash is not null and invite_expires_at < now() - interval '30 days'` (spec 0009) |
| Stripe reconcile | the subscriptions to walk | `stripe.subscriptions.list({ status: "all", limit: 100 })` with auto pagination, each parsed by the existing `retrievedSubscription` schema in `src/payments/events.ts` |
| Stripe reconcile | the agency for a subscription | `resolveOrgId` (existing row by `stripe_customer_id`, else metadata `org_id`) and `organizationExists`, both from `src/payments` (spec 0007) |
| Stripe reconcile | which subscription wins for an agency | the greatest `created` among the subscriptions resolving to that agency (`created` parsed from Stripe's `created` unix timestamp, new in `retrievedSubscription`), tie broken toward the one whose `status` is not `canceled`, then by Stripe id for determinism |
| Stripe reconcile | the state written | `applySubscriptionState`, the same lock, the same customer id guard, the same fields and the same `past_due_since` `coalesce` the webhook writes (spec 0007) |
| Stripe reconcile | `customer_conflict` | `applySubscriptionState` returned `"customer_id_conflict"`: the locked row's `stripe_customer_id` differs from `subscription.customer` (spec 0007, AC-27) |
| Stripe reconcile | `unlisted` rows | `subscriptions.stripe_subscription_id` not in the set of ids the complete listing produced |
| Clerk reconcile | organizations, memberships, users | `clerk.organizations.getOrganizationList`, `clerk.organizations.getOrganizationMembershipList({ organizationId })`, `clerk.users.getUserList`, each paged at 100 with `offset` until a short page, mapped to `MirrorOrganization`, `{ clerkUserId, role }` and `MirrorUser` by the two new pure mappers `toMirrorOrganization` and `toMirrorUser` in `src/auth/clerk.ts` plus `toMembershipRole()`; no object is fetched by id |
| Clerk reconcile | the membership role | `toMembershipRole()` (spec 0015) |
| Clerk reconcile | which listed users get an update | the intersection of the listing with the local live user set read once at the start of the pass (`users.clerk_user_id where deleted_at is null`) |
| Clerk reconcile | `skipped_deleted` | `upsertOrganizationRow` returned `"deleted"` (spec 0015, AC-5) |
| Clerk reconcile | which local rows to remove | live local rows (`deleted_at is null`) whose Clerk id is absent from a listing that completed; never from a partial one (AC-8) |
| Clerk reconcile | the subscription status logged on a soft delete | `subscriptions.status` for that organization read inside the same transaction, or `none` (spec 0015, AC-6) |
| Retention prune | the cutoffs | `now() - interval '90 days'` on `processed_webhook_events.processed_at` (spec 0002) and on `cron_runs.started_at` (this spec) |
| Every sweep | `counts` | integers the sweep tallies as it goes; the names per sweep are fixed in `src/cron/sweep.ts` so the report is stable for whoever reads it later |

**Key invariants**:
- The route is the only importer of `withSystemAccess` for this feature, and the runner and every sweep take their handle as an argument, exactly like `handleClerkWebhook` and `handleStripeWebhook` (spec 0003).
- A sweep never stops another sweep: every `Sweep.run` call sits in its own `try`/`catch` in the runner, and the runner never rethrows a sweep error.
- Every sweep is idempotent by construction: the overdue write is a compare and set on `status = 'sent'`, deletes tolerate a missing object or row, upserts mirror provider state. That is why no lock exists (AC-12).
- Removal order is object first, then row, without exception (spec 0011). A row is never deleted while its object might still exist.
- Nothing is soft deleted, scrubbed or removed from a mirror on the strength of an incomplete provider listing (AC-8). Clerk upserts from a partial listing are fine because each mirrors one independent object; the Stripe sweep writes nothing from a partial listing because the newest per agency rule needs the whole set (AC-7).
- One agency, at most one Stripe customer: `applySubscriptionState` carries the lock and the customer id guard, so neither the webhook nor the reconcile can move an agency onto a different customer (spec 0007, AC-27).
- The reconcile never creates a `users` row from the user listing; only a membership listing creates one, as the matching webhook event would.
- `deleted_at` on `organizations` and `users` only ever moves from null to set (spec 0015). The reconcile never revives a row: `ensureUserRow` refuses a scrubbed user and `upsertOrganizationRow` never writes `deleted_at`.
- `today` is one UTC calendar day per run, computed once by the application and passed down (specs 0002, 0010, 0012). Nothing in a sweep calls the clock for the day.
- The report, the body and the logs carry no personal data (AC-10).
- Every write the reconciles make goes through the same functions the webhooks use (`applySubscriptionState`, `upsertOrganizationRow`, `ensureUserRow`, `upsertMembershipRow`, `softDeleteOrganization`, `deleteMembershipRows`, `unbindContactsOfUser`); the reconcile owns no write of its own.
- The current run's `cron_runs` row is never pruned by its own retention sweep (the cutoff is 90 days old; the row is seconds old).

**Security model**:
- The route is public in `src/proxy.ts` (spec 0005, AC-4 already lists `/api/cron/(.*)`), so the secret check is the whole gate. It runs before anything else, compares in constant time, and answers `401` with no detail. There is no session, no tenant and no role.
- The route writes across every agency by design, which is exactly the case spec 0003 opened `withSystemAccess` for. The lint rule and its config test already name this file path.
- `CRON_SECRET` is a Vercel project environment variable (Vercel generates and sends it when a `crons` entry exists); locally it lives in `.env`, never in the repository.
- The two reconciles read every subscription in the Stripe account and every organization, membership and user in the Clerk instance. Those calls use the secret keys the webhooks already use; no new credential.
- Personal data (spec 0015 and the GDPR angle it raised): the Clerk user pass writes email, name and image URL into `users` only through `ensureUserRow`, the same as the webhook; the scrub path is the spec 0015 AC-9 path; nothing personal reaches the report or a log line (AC-10).
- Rate limiting: the secret is the limit. A wrong token costs one hash and one log line; no database read. Feature 19 may add a ceiling on `401` answers if the log ever shows scanning.

**Configuration required**:
- `CRON_SECRET`: the bearer token Vercel Cron sends and the route requires (AC-1). Required in every environment, at least 16 characters, added to `src/lib/env.ts` and read through `env()`. Generate one with `openssl rand -hex 32` for `.env`; on Vercel, add the same variable to the project so the scheduled call and a manual `curl` agree.
- `vercel.json`: `"crons": [{ "path": "/api/cron/daily", "schedule": "0 3 * * *" }]` (AC-11). Hobby runs a daily cron within the scheduled hour, not at the minute, and never retries.
- No new Stripe, Clerk or R2 credential. The reconciles reuse `STRIPE_SECRET_KEY` and `CLERK_SECRET_KEY`; the abandoned upload sweep reuses the R2 variables and skips when they are absent.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: with the bearer header, the route inserts a run row, runs all six sweeps in order against fakes, updates the row with `outcome: "ok"` and a six entry report, and answers `200` with the same report; against real PostgreSQL in `src/cron/runner.db.test.ts`, verifies **AC-2**, **AC-3**.
- Happy path: an invoice `sent` with `due_date` yesterday (UTC) becomes `overdue` with one `overdue` event and a null actor; one due today, one `draft`, one `paid` and one `void` with past dates are untouched; running the sweep again writes nothing; `src/invoices/overdue-sweep.db.test.ts`, verifies **AC-4**, **AC-12**.
- Happy path: three `pending` deliverables older than 24 hours are removed object first from the fake storage and then from the table; a `pending` row 23 hours old and a `ready` row are untouched; with 201 qualifying rows the sweep removes 200 and reports `truncated: true`; `src/deliverables/abandoned-sweep.db.test.ts`, verifies **AC-5**.
- Failure case: the fake storage fails the delete of the second of three objects; the first and third rows are gone, the second row stays with its object, the report counts one failed row, the sweep is `failed`, and the run answers `500` while the sweeps after it still ran; verifies **AC-3**, **AC-5**.
- Failure case: a sweep whose `run` throws is recorded `failed` with the message; the sweeps after it have reports; the run row shows `failed`; the route answers `500`; a runner unit test with fake sweeps in `src/cron/runner.test.ts`, verifies **AC-3**.
- Happy path: the fake Stripe list yields a subscription whose customer matches a local row with a stale status; after the sweep the row carries Stripe's status, `current_period_end`, price and `cancel_at_period_end`; a subscription with no local row but an `org_id` metadata naming a real agency gets a row; one naming no agency is counted `unresolved` and creates nothing; a local row absent from the listing is counted `unlisted` and unchanged; an agency with an old `canceled` subscription and a newer `active` one ends `active` whatever order the fake lists them, with `superseded: 1`; a subscription whose customer differs from the agency's stored one is counted `customer_conflict` and the row is unchanged; `src/payments/reconcile.db.test.ts`, verifies **AC-7**.
- Failure case: the fake Stripe list throws on page two; nothing is written, no `unlisted` count is produced, the sweep is `failed`; verifies **AC-7**.
- Happy path: the fake Clerk lists two organizations, one of which is unknown locally and gets created with a slug from `freeSlug()`; a membership listed in Clerk but missing locally is created; a local membership absent from Clerk's complete list for that organization is deleted; a local live organization absent from Clerk's complete list is soft deleted with its memberships removed and the subscription status logged; a local live user absent from Clerk's complete user list is scrubbed, their memberships removed and their contact rows unbound; a scrubbed local user who reappears in a membership list is counted `skipped_scrubbed` and stays scrubbed; a listed Clerk user with no local row and no membership gets no row; a locally soft deleted organization still listed by Clerk is counted `skipped_deleted`, keeps `deleted_at`, and gets no membership writes; `src/auth/reconcile.db.test.ts`, verifies **AC-8**.
- Failure case: the fake Clerk organization list throws on page two; the organizations from page one are upserted, nothing is soft deleted, the sweep is `failed`; the same for a membership list of one organization (that organization loses no membership rows) and for the user list (nobody is scrubbed); verifies **AC-8**.
- Happy path: `expired_invites` nulls the two columns on a row expired 31 days ago and leaves a row expired 29 days ago and an accepted row alone; the retention prune removes a 91 day old `processed_webhook_events` row and a 91 day old `cron_runs` row and keeps the current run's row and an 89 day old one; verifies **AC-6**, **AC-9**.
- Auth/permission: no header, a wrong token, a token of a different length, and `Basic` instead of `Bearer` each answer `401` with `{}` and no `cron_runs` row is inserted; `src/app/api/cron/daily/route.test.ts`, verifies **AC-1**.
- Auth/permission: the env schema refuses to parse with `CRON_SECRET` unset or shorter than 16 characters, in `src/lib/env.test.ts`, verifies **AC-1**.
- Concurrency: two runner calls started against the same database at once leave two run rows, one `overdue` event per invoice, and no thrown error from the abandoned sweep; verifies **AC-12**.
- Privacy: the report and every captured log line for a run that scrubbed a user and soft deleted an organization contain no `@`, no name and no image URL; a test greps the captured output; verifies **AC-10**.
- Lint: `tools/eslint/tenant-isolation-config.test.mts` still passes with the route file in place and an import of `withSystemAccess` from `src/cron/runner.ts` fails lint; verifies **AC-11**.

## Build plan

Tracer Bullet: milestone 1 pushes one thin thread through every layer (secret, run row, runner, one real sweep, the schedule) so a real scheduled run lands in `cron_runs` before any other sweep exists. The later milestones each add sweeps to a runner that is already proven in production. Milestones 3 and 4 are independent of each other and of 2; only 5 depends on all of them.

1. **The thread: secret, run record, runner, overdue sweep, schedule.** Add `CRON_SECRET` to `src/lib/env.ts`; the `cron_runs` table in `src/db/schema/cron.ts` with its `drizzle-zod` schemas, `pnpm db:generate`, and the `db-schema-assert` extension; `src/cron/sweep.ts`, `src/cron/secret.ts`, `src/cron/log.ts`, `src/cron/runner.ts` (run row insert and update, per sweep isolation, report, log lines); `src/invoices/overdue-sweep.ts` with the `canTransition` assertion, the one transaction and the revalidation; `src/cron/daily.ts` wiring only that sweep; the route with its three exports and the `401` path; the `vercel.json` `crons` entry; the runner, secret, route and overdue tests. Deploy and confirm one scheduled run row. Satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-11**.
2. **Storage and invitations.** `src/deliverables/abandoned-sweep.ts` (the 24 hour cutoff, oldest first, the 201 row read, object first per row, the failed row count, `truncated`, the `skipped` branch) and `src/contacts/expired-invites-sweep.ts`; both added to `src/cron/daily.ts`; their database tests including the failing fake store. Satisfies **AC-5**, **AC-6**.
3. **Stripe reconcile.** Move `applyState`, the `for update` read, the customer id guard and `resolveOrgId` out of `src/payments/webhook.ts` into `applySubscriptionState` in `src/payments/subscription-mirror.ts` and call it from the webhook (the webhook tests must pass unchanged); add `created` to `retrievedSubscription`; add `StripeListGateway`, `liveStripeListGateway()` and a fake; `src/payments/reconcile.ts` with the complete listing rule, the resolve, the newest per agency rule, the apply, and the `unresolved`, `customer_conflict`, `superseded` and `unlisted` counts; wire it; the database tests. Satisfies **AC-7**.
4. **Clerk reconcile.** Extract `toMirrorOrganization` and `toMirrorUser` in `src/auth/clerk.ts` and use them from the existing fetchers; add `ClerkListGateway`, `liveClerkListGateway()` (three paged list calls through those mappers, no per object fetch) and a fake; `src/auth/reconcile.ts` with the three passes, the local user set read first, the `"deleted"` handling, the complete listing rule per pass, the per object transactions and counts; wire it; the database tests including each partial listing case. Satisfies **AC-8**.
5. **Retention, overlap, privacy, verification.** `src/cron/retention-sweep.ts` wired last; the overlap test; the privacy grep test over the report and captured logs; run the manual `curl` locally and one scheduled run on Vercel, and record both walks in `verify.md`. Satisfies **AC-9**, **AC-10**, **AC-12**.

## Consequences

**Positive**:
- Every nightly job the earlier specs deferred to "feature 18" now has one home, one guard, one log shape and one record, and adding a seventh sweep is one file plus one line in `src/cron/daily.ts`.
- A missed Stripe or Clerk webhook is repaired within a day, which closes the lockout risk spec 0008 named as the one most likely to bite, and the deleted teammate risk spec 0015 left open.
- The `cron_runs` row outlives Vercel Hobby's log retention, so "did it run" and "what did it do" are answerable from SQL weeks later, and a run killed by the platform is visible as a row with no `finished_at`.
- The webhook and the reconcile share one write function per provider, so they cannot disagree about what a mirrored row looks like.

**Negative / tradeoffs**:
- Six sweeps in one serverless call share one 300 second budget. The two reconciles walk every object in two provider accounts each night; at a few hundred agencies that is seconds, at tens of thousands it is a different design (a queue, or per page continuation across runs). The per run row cap only exists on the storage sweep.
- The Stripe reconcile's `past_due_since` is set to the reconcile's clock when it is the first writer to see `past_due`, which can be up to a day later than the real event, so a grace window measured from it (spec 0008) runs up to a day long. Conservative, but not exact.
- The abandoned upload query filters on `status` and `created_at` across every agency, while the index spec 0011 pointed at is prefixed by `org_id`. PostgreSQL will scan that index rather than seek; with pending rows being rare this is cheap, and a partial index `(created_at) where status = 'pending'` is the fix if it ever shows in a slow query log.
- A soft deleted agency's Stripe subscription keeps billing and its rows and files stay. This spec reconciles that subscription's state faithfully but deliberately does not cancel it; the purge is deferred (Follow-up).
- Hobby cron never retries and fires within the hour. A run that fails is visible (the `500`, the row) but is not attempted again until the next night, and nobody is paged until feature 20 exists.
- `cron_runs.report` is `jsonb` with a shape enforced only by the writer. A later reader has to trust the `counts` names fixed in `src/cron/sweep.ts`.

**Neutral**:
- One migration (`cron_runs`). No change to any tenant table, the tenant registry, the lint exemption list or `src/proxy.ts`.
- `src/payments/webhook.ts` loses two private functions to a shared module; its behaviour and tests do not change.
- A new `src/cron/` feature folder holds the runner and the two sweeps that belong to no single feature; every other sweep sits in the feature it serves, next to the helpers it reuses.
- The `verify.md` walk includes a real scheduled run on Vercel, which is the only way to prove the `crons` entry and the generated secret line up.

## Follow-up

- [ ] **Deleted agency purge**: cancel the Stripe subscription of a soft deleted agency, and after a grace period remove its rows and its R2 objects. Destructive, so it is its own decision: `/architect deleted agency purge`. Until then spec 0015's note stands: storage cost accrues for dead agencies and their subscription bills on.
- [ ] Feature 20 (product analytics and error tracking) should forward the `cron.run` line with `outcome: "failed"` to Sentry as an error, so a red night is noticed without reading the Vercel dashboard.
- [ ] Feature 19 (rate limiting): consider a ceiling on `401` answers from `/api/cron/daily` if the log line ever shows scanning; not needed for correctness.
- [ ] If pending deliverables ever grow past a few thousand rows, add the partial index `deliverables (created_at) where status = 'pending'` named in Consequences.
- [ ] If either provider account grows past a few thousand objects, split the reconciles so each run continues from where the last stopped (a cursor in `cron_runs.report`) rather than walking everything nightly.
- [ ] The scope's deferred **Agency timezone** item still applies: the overdue cutoff is the UTC day. When `organizations.timezone` lands, the sweep computes `today` per agency from that column and the query becomes per organization.
- [ ] Spec 0011's follow up saying the sweep uses the `(org_id, status, created_at)` index should be read as "scans", per Consequences; no change to spec 0011 needed.
- [ ] Two specs are numbered 0015 once this branch merges with `main` (`0015-clerk-webhook-sync` here, `0015-team-members-and-roles` on `main`). This spec took 0017 so the renumbered one can take 0016 without a second rename.
