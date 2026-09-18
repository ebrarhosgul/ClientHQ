# 0017. Daily cron sweeps: rationale

The decision record for [index.md](index.md). `/develop` does not need this file; it is for the person deciding whether the decision still holds.

## Context

Seven earlier specs deferred a nightly job to "feature 18" without designing it. Spec 0001 fixed the shape (one route at `/api/cron/daily`, guarded by `CRON_SECRET`, sweeps in sequence, because Vercel Hobby allows two daily cron slots) and named two sweeps: overdue invoices and abandoned uploads, with the route's own queries doubling as the Supabase keep alive. Spec 0002 fixed the 90 day ledger prune. Spec 0009 asked for an invite token tidy. Spec 0007 and spec 0008 flagged Stripe drift as the gap most likely to bite: a misconfigured or disabled webhook freezes the local subscription mirror, and the access gate then locks out an agency that is paying. Spec 0015 asked for the matching Clerk reconcile, a decision on soft deleted agencies, and a prune for the ledger it now also feeds. Spec 0010 and spec 0012 fixed how "today" is computed. This spec is where all of that lands, and the scope row's "done when" is the minimum it must meet: refuse an unauthenticated call, mark the right invoices and no others, remove abandoned uploads with their objects, and never let one sweep's failure skip the rest.

The forces are operational, not algorithmic. Every sweep is a few statements; what matters is how they run together and how anyone finds out what happened. Vercel Hobby fires a daily cron within the scheduled hour, never retries it, caps one function call at 300 seconds, and keeps runtime logs for about an hour. Sentry is not installed until feature 20. The Supabase free tier pauses a project after a week without activity. The database is reached through a transaction mode pooler, which rules out session level advisory locks. The tenancy fence (spec 0003) already reserves a named, lint fenced door for exactly this route and expects the handle to be passed in, not imported.

Two of the sweeps talk to providers that hold the truth about money and identity. Reconciling means listing what the provider has and writing it locally, and the dangerous half of that is the deletions: a listing that fails partway looks, to naive code, like "these objects are gone". The same failure would soft delete live agencies or scrub live people. Whatever the design, that must be impossible.

Not deciding leaves invoices `sent` forever, storage filling with invisible files, a mirror that drifts silently until someone is locked out, and a free database that may pause on a quiet week.

## Options considered

### Option 1: One route, sweeps in sequence, logs only (spec 0001 as sketched)

The route runs the sweeps one after another inside `withSystemAccess`, each in a `try`/`catch`, and logs a line per sweep. No new table. The reconciles are left to a later feature.

**Pros**:
- No migration, the smallest build, exactly what spec 0001 wrote down.
- Every sweep is already fully specified elsewhere; this is wiring.

**Cons**:
- Vercel Hobby keeps logs for about an hour, so by morning nothing says what last night's run did, or whether it ran at all beyond a green or red dot.
- Leaves the Stripe drift gap that two specs called the most likely production incident, and the Clerk drift spec 0015 named, for yet another feature.
- The keep alive is implicit: if every sweep short circuits on an empty table, the run may touch the database with statements that match nothing, which still counts as activity but is nothing anyone can point to.

### Option 2: One route, isolated sweeps, a `cron_runs` record, both reconciles (chosen)

The same single route and sequence, with each sweep an isolated function taking the handle, a runner that inserts a run row before the sweeps and updates it after with a per sweep report, and the Stripe and Clerk reconciles included as sweeps that reuse the webhooks' write functions and never delete on a partial listing.

**Pros**:
- The run row is a durable record that outlives the logs, doubles as the keep alive (a real write every night), and shows a platform timeout as a row with no finish time.
- Closes the two drift gaps in the feature every spec pointed at, with no new vendor and no new credential, reusing the exact write path the webhooks use.
- A sweep is one file and one line to add; the runner never changes.

**Cons**:
- One more table and one more migration.
- Six sweeps share one 300 second budget; the reconciles walk two whole provider accounts nightly, which stops fitting at a scale this product does not have yet.
- The Clerk reconcile is the most involved code in the feature (three passes, three completeness rules).

### Option 3: A job per sweep on Upstash QStash schedules

Upstash is already in the stack for rate limits, and QStash offers per job cron schedules with retries and a signed callback to a route per sweep. Each sweep becomes its own route and its own schedule.

**Pros**:
- Retries on failure and independent schedules; a slow reconcile does not share a budget with the invoice sweep.
- Not bound by Vercel's two cron slots.

**Cons**:
- Six public routes to guard instead of one, six schedules to configure outside the repository, and a second signing scheme beside `CRON_SECRET`.
- The tenancy lint fence names one cron file on purpose; six routes means six exemptions, or a rewrite of the fence.
- Adds a vendor to the critical path for work that takes seconds and has no measured problem. The team operating this at 2am is one person.

### Option 4: `pg_cron` inside Supabase for the SQL only sweeps

Supabase offers the `pg_cron` extension. The overdue, invite tidy and prune sweeps are single statements and could run inside the database on a schedule, with the route keeping only the storage and provider sweeps.

**Pros**:
- No HTTP hop and no serverless timeout for the SQL sweeps; runs even if the app is down.
- The database is its own keep alive.

**Cons**:
- Splits the sweeps across two places with two ways to find out what happened, and the SQL half bypasses `withSystemAccess`, its reason string and its log line, which spec 0003 made the one way to touch every tenant at once.
- Half the sweeps still need the route (R2, Stripe, Clerk), so it saves nothing structurally.
- `today` would come from the database clock in SQL and from the application in the route, the exact disagreement spec 0002 avoided.

## Rationale

Option 2 is Option 1 plus the two things the forces demand. The log retention force is the decisive one: without a durable record, the answer to "did the sweep run last night" is a dashboard dot, and the answer to "what did it do" is nothing. One small table fixes that and gives the keep alive an explicit, auditable form. The drift force is the second: spec 0008 measured what a stale subscription row costs (a paying agency locked out) and spec 0015 what a stale user row costs (a deleted person still named on a member list), and both are repaired by the same walk over provider state through the write functions the webhooks already trust. Putting them here costs no new vendor, credential or fence exemption, which is why Option 3 loses: it buys retries the sweeps do not need at the price of six guarded surfaces and a second scheduler outside the repository. Option 4 breaks the one door rule of spec 0003 for a saving that does not exist once half the sweeps need the route anyway.

The engineer's choices during design all followed the recommended line, and two of them deserve the reasoning on record. A `500` on partial failure rather than `200` exists because the Vercel cron dashboard is the only alert until feature 20; a green run that hid a failed sweep would be worse than no report. No lock across overlapping runs exists because every sweep is idempotent by construction, and a lock through a transaction mode pooler would have to be a `cron_runs` based guard that blocks the retry after a crash, the one time a person most wants to rerun by hand.

The "no removal on a partial listing" rule (AC-8, and the `unlisted` skip in AC-7) is the load bearing safety rule of the two reconciles and the reason each pass tracks whether its listing completed. Upserts from a partial listing are safe because each one writes real provider state for one object; deletions are only safe when absence from the listing means absence from the provider, which a partial listing cannot say. This is stated as an invariant rather than left to the build because it is the mistake a reconcile is most likely to ship with.

An independent cross check of the draft changed one rule and closed five gaps. The Stripe sweep originally applied upserts from the pages it had seen, like the Clerk sweep still does; the check pointed out that `subscriptions` is keyed on the agency, so a churned customer's old canceled subscription on one page could overwrite the active one on a later page, exactly the lockout the sweep exists to prevent. The Stripe sweep therefore buffers the complete listing and applies only the newest subscription per agency, which needs Stripe's `created` field and a complete set. The five gaps were places where the spec named an existing function whose real behaviour did not match the rule (`ensureUserRow` inserts strangers, `upsertOrganizationRow` can answer `"deleted"`, the Clerk fetchers are not pure mappers, the customer id guard lived in the webhook handler rather than in the write it guards) plus the missing count vocabulary; each is now named in the build spec.

Two recommendations were settled at write time rather than asked, because they are internal: the code layout (sweeps beside the feature they serve, the runner and the cross feature prune in `src/cron/`, so each sweep sits next to the helpers it asserts against) and the extraction of `applyState` and `resolveOrgId` into `src/payments/subscription-mirror.ts` (the runner up was calling the webhook handler with a synthetic event, which would have written ledger rows for events that never happened). The listing shapes for Clerk and Stripe are narrow gateway types with fakes, mirroring `StripeGateway` and `ClerkGateway`, so every reconcile rule is testable without a network, exactly as the webhooks are.

## Evidence

Commitments this spec inherits, with where they were made:

| Commitment | Source |
|---|---|
| One route, `/api/cron/daily`, `CRON_SECRET`, sweeps in sequence, two Hobby cron slots, the route as keep alive | spec 0001, Scheduled work |
| `withSystemAccess` importable only from the webhook and cron files; the config test names `src/app/api/cron/daily/route.ts` | spec 0003, AC-12; `tools/eslint/tenant-isolation-config.test.mts` |
| `/api/cron/(.*)` is public in `src/proxy.ts` | spec 0005, AC-4 |
| Overdue rule `status = 'sent' and due_date < today`, today supplied by the application on the same basis as `issue_date` | spec 0002, value sourcing; spec 0010; spec 0012, AC-12 |
| One `overdue` event per moved invoice, null actor, through `canTransition` | spec 0012, AC-15 and follow up |
| Abandoned uploads: `pending` older than 24 hours, object first, through the storage port | spec 0011, AC-8 and follow up |
| Ledger prune at `processed_at < now() - 90 days` | spec 0002, value sourcing |
| Invite token tidy after 30 days expired | spec 0009, follow up |
| Stripe drift reconcile | spec 0007 and spec 0008, follow ups |
| Clerk reconcile, the soft delete and scrub paths it reuses, the ledger now fed by two sources | spec 0015, AC-6, AC-9, follow ups |
| Storage may be unconfigured outside production and that is a supported state | spec 0011, AC-18; `src/lib/env.ts` |
| Stripe and Clerk keys are required in every environment | `src/lib/env.ts` |
| Sentry is not yet installed | `package.json`; scope feature 20 |
