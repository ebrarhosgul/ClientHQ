# 0018. Rate limiting

**Date**: 2026-09-18
**Status**: In Progress

## Summary

Four actions that cost real money or provider quota get a ceiling: requesting an upload URL, issuing an invoice, resending an invoice email, and creating an agency. Each ceiling is a fixed number of attempts per agency (or per person, for creating an agency) inside a window aligned to the clock, counted in one small Postgres table with a single atomic statement (one insert or increment that can never miss a concurrent call), so no new provider is needed and spec 0001's Upstash plan is retired. Past the ceiling the action refuses with a plain message saying what the allowance is and roughly when it resets, and if the counter itself ever fails the action goes ahead and a log line records that the check was skipped. The action wrapper gains one declarative field, so opting an action in is one line and visible in its config.

## Requirements

**User stories**:
- As an agency staff member, I want a runaway script or a hostile colleague to be stopped before they fill our file storage or burn the email quota, so that the product keeps working for the rest of us.
- As an agency staff member refused by a ceiling, I want to be told what the allowance is and when I can try again, so that I am not left guessing.
- As the operator, I want the ceilings to never be the reason an action fails, so that a counter hiccup does not take invoicing down.
- As a builder, I want opting an action in to be one declared field, so that the next limited action cannot be wired wrong.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Three named policies exist as constants in `src/rate-limit/policies.ts`, each `{ action, limit, windowSeconds }`: `UPLOAD` (`action: "upload"`, 60 per 3600 seconds), `INVOICE_EMAIL` (`action: "invoice_email"`, 50 per 86400 seconds) and `CREATE_AGENCY` (`action: "create_agency"`, 3 per 86400 seconds). `requestUpload` declares `UPLOAD`; `issueInvoice` and `resendInvoiceNotification` both declare `INVOICE_EMAIL` and so share one allowance per agency; `createAgency` uses `CREATE_AGENCY` keyed per person. No other action declares a policy in this feature, and the invitation limits from spec 0009 are untouched.
- **AC-2**: In `withTenantAction`, the check runs after the input parses and before the handler, on the pooled executor and never inside the action's transaction. A refused call returns `{ ok: false, error: { code: "rate_limited", message } }`, the handler never runs (so `requestUpload` inserts no row and signs nothing), `revalidate` is not called, and the role and subscription gates still run first, so a signed out or locked caller never learns the ceiling exists.
- **AC-3**: Every attempt that reaches the check consumes one unit, whether the attempt is then allowed, refused, or allowed but fails later in the handler. The consume is one SQL statement: insert `count = 1, updated_at = now` for `(subject, action, window_start)`, on conflict set `count = count + 1, updated_at = excluded.updated_at`, returning `count`; the attempt is allowed exactly when the returned `count <= limit`. Sixty parallel calls against a fresh upload window all succeed and leave `count = 60`; the sixty first, whenever it lands, is refused.
- **AC-4**: Windows are fixed and aligned to the UTC clock: `window_start = floor(now / windowSeconds) * windowSeconds` as a timestamp, so the hourly window resets on the hour and the daily windows at 00:00 UTC. The first attempt after a boundary starts a new row at `count = 1`, and a burst that straddles a boundary may reach up to double the ceiling across the two windows, which is accepted.
- **AC-5**: The refusal message names the allowance and a relative reset time rounded up. Let `minutes = ceil(retryAfterSeconds / 60)`, never below 1: when `minutes < 60` the time reads `in about N minutes` (`in about 1 minute` at 1), otherwise `hours = ceil(retryAfterSeconds / 3600)` and it reads `in about N hours` (`in about 1 hour` at 1), so 3599 seconds reads `in about 1 hour`, never `in about 60 minutes`. The three texts are: `Your agency has reached its upload allowance of 60 an hour. Try again in about N minutes.`, `Your agency has reached its allowance of 50 invoice emails a day. Try again in about N hours.` and `You have reached the allowance of 3 new agencies a day. Try again in about N hours.`, with the unit and its singular switching by the rule above. The message is returned in `error.message`, so `errorMessage()` shows it in place of the generic `rate_limited` sentence, which stays as the floor.
- **AC-6**: `createAgency` consumes `CREATE_AGENCY` for subject `user:<clerk user id>` after the signed in check and after the existing agency short circuit finds nothing, immediately before `createClerkOrganization` is called, so a double submit that resolves to an existing agency costs nothing and no Clerk organization is ever created past the ceiling. A refusal returns `rate_limited` with the AC-5 message and the onboarding form shows it in its existing error region.
- **AC-7**: When the consume statement throws (connection error, timeout, any failure), the door itself returns `allowed` and writes one structured log line `event: "rate_limit.skipped"` carrying `subject`, `action` and the error's `name`; the action proceeds as if no ceiling existed. Fail open is the only failure behaviour; there is no fail closed path and no environment switch that disables the limiter.
- **AC-8**: Every refusal, whichever caller asked, is logged by the door itself as one structured line `event: "rate_limit.refused"` with `subject`, `action`, `count`, `limit` and `windowStart`, written as `console.warn(JSON.stringify(line))` in the shape of `src/auth/webhook-log.ts`, whose own fields (`eventId`, `clerkOrgId`, and so on) are camelCase for the same reason. Neither log line carries a name, an email address or any input field; the subject is an id.
- **AC-9**: A new table `rate_limit_windows` (`subject text`, `action text`, `window_start timestamptz`, `count integer`, `updated_at timestamptz`, all not null, primary key `(subject, action, window_start)`, index `rate_limit_windows_window_start_idx` on `window_start`, no foreign keys, and deliberately no check constraint on `subject` or `action`, so a fourth policy or a new subject kind needs no migration) is added by one Drizzle migration; `src/db/schema/zod.ts` and `scripts/db-schema-assert.ts` gain the table; `pnpm db:migrate:check` and `db:schema:assert` pass.
- **AC-10**: The `retention_prune` sweep (spec 0017) also deletes `rate_limit_windows` rows with `window_start < now() - interval '7 days'` and reports the count as `rate_limit_windows_pruned`, leaving a row from 6 days ago in place.
- **AC-11**: No one bypasses a ceiling: `org:admin` and `org:member` share the agency allowance equally, and nothing in the product reads or displays a counter. Contact sessions never meet the limiter, because no portal route uses `withTenantAction` and none is opted in.
- **AC-12**: `resendInvoiceNotification` keeps its per invoice five minute cooldown from spec 0012 exactly as it is today, refusing with `conflict` and its existing message; the policy check runs first (in the wrapper) and refuses with `rate_limited`, the cooldown second (in the handler). Nothing about the cooldown's code, message or placement changes.
- **AC-13**: The wrapper's reserved `rateLimit?: never` slot becomes `rateLimit?: RateLimitPolicy`; passing anything but one of the three exported policies is a type error. No environment variable is added, `src/lib/env.ts` is unchanged, and `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from spec 0001 are formally dropped.
- **AC-14**: On each of the four screens (the upload picker on a project page, the invoice issue and resend controls, and the onboarding form) a refusal shows the AC-5 sentence in that screen's existing error region, announced to assistive technology the way that region already is; no new component is built and axe stays clean.

## Options considered

Reasoning and options: see [rationale.md](rationale.md).

## Decision

**Chosen option**: Option 2: A Postgres counter table with fixed clock windows, consumed by one atomic upsert through a declarative wrapper slot.

One bookkeeping table and one named door in the tenant layer give every limited action an exact, concurrency safe count with no new provider; the action wrapper's reserved slot takes a named policy, the refusal carries a relative reset time, the door fails open with a log line, and the nightly prune keeps the table small.

**Implementation skills**: `drizzle` (`.agents/skills/drizzle/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `zod` (`.agents/skills/zod/`) · `vitest` (`.agents/skills/vitest/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

`rate_limit_windows` (new, bookkeeping, reached only through the named door; like `cron_runs` it carries no `org_id`, because one of its subjects is a person with no agency yet):

| Column | Type | Null | Notes |
|---|---|---|---|
| `subject` | text | no | `org:<organizations.id>` for the agency policies, `user:<clerk user id>` for `create_agency` |
| `action` | text | no | the policy's `action`: `upload`, `invoice_email`, `create_agency` |
| `window_start` | timestamptz | no | the window's opening instant, truncated on the clock per AC-4 |
| `count` | integer | no | attempts consumed in this window, starts at 1 |
| `updated_at` | timestamptz | no | the last consume, set by both branches of the upsert; for debugging an abuse report only |

Primary key `(subject, action, window_start)`. Index `rate_limit_windows_window_start_idx` on `window_start` for the prune. No foreign keys and no relations: a deleted agency's rows age out in a week. No check constraint on `subject` or `action`, by design (AC-9). In Drizzle the two timestamps are `timestamp(..., { withTimezone: true, mode: "date" })` and `count` is `integer`, matching `src/db/schema/cron.ts`. Schema file `src/db/schema/rate-limit.ts`, exported from `src/db/schema/index.ts`; it is not a tenant table and is not registered in `src/db/tenant/tables.ts`, so `tenantDb()` cannot reach it.

**State transitions**: none. A row only ever increments and is later pruned.

**Modules**:

| File | Holds |
|---|---|
| `src/rate-limit/policies.ts` | `RateLimitPolicy` type and the three `as const` policies (AC-1). No server imports. |
| `src/rate-limit/window.ts` | Pure: `windowStart(now, windowSeconds)`, `retryAfterSeconds(windowStart, windowSeconds, now)` (whole seconds, rounded up), and `refusalMessage(policy, retryAfterSeconds)` with the rounding and singular rule (AC-4, AC-5). Also the `RateLimitVerdict` type below. Unit tested. |
| `src/rate-limit/log.ts` | `logRefused(verdict)` and `logSkipped({ subject, action, errorName })`, each `console.warn(JSON.stringify(line))` with an `event` and `at` field in the `webhook-log.ts` shape (AC-7, AC-8). |
| `src/db/tenant/rate-limit.ts` | The door: `consume(subject: RateLimitSubject, policy: RateLimitPolicy, now: Date): Promise<RateLimitVerdict>`. Imports `pooledDb()` (allowed inside `src/db/tenant/`; it already runs with `prepare: false` for the transaction mode pooler, and the door never opens a client of its own), runs the upsert, builds the verdict, calls `logRefused` on a refusal, catches any throw and returns `allowed` after `logSkipped` (AC-3, AC-7, AC-8). All logging lives here so `createAgency` and the wrapper get it alike. Exported from `src/db/tenant/index.ts` beside `nextInvoiceNumber`. |
| `src/db/tenant/action.ts` | The slot and the check between parse and handler (AC-2, AC-13). |
| `src/auth/agency.ts` | The direct call before `createClerkOrganization` (AC-6). |
| `src/cron/retention-sweep.ts` | The third delete, with its own `SEVEN_DAYS_MS` constant and `rateLimitCutoff` beside the existing 90 day cutoff (AC-10). |

`RateLimitSubject` is `{ kind: "org", id: string } | { kind: "user", id: string }`, rendered to the text column as `${kind}:${id}` inside the door, so no caller builds the string.

`RateLimitVerdict` is one type used by the door, the wrapper, `createAgency` and the log: `{ allowed: true }` or `{ allowed: false, subject: string, action: string, count: number, limit: number, windowStart: Date, retryAfterSeconds: number, message: string }`.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `consume` (door, `src/db/tenant/rate-limit.ts`) | function | `subject: RateLimitSubject` (req), `policy: RateLimitPolicy` (req), `now: Date` (req) | `RateLimitVerdict` (above) | called by the wrapper and `createAgency` only | never throws; a store failure is `allowed` plus `rate_limit.skipped`; a refusal is logged here |
| `withTenantAction({ rateLimit })` | config field | `rateLimit?: RateLimitPolicy` | the action returns `rate_limited` with `message` when refused | as the action | `rate_limited` |
| `requestUpload` | Server Action | unchanged (spec 0011) | unchanged | staff, full subscription | adds `rate_limited` before `not_found` and `conflict` |
| `issueInvoice`, `resendInvoiceNotification` | Server Action | unchanged (spec 0012) | unchanged | staff, full subscription | adds `rate_limited` (policy) ahead of the existing refusals; resend keeps its cooldown `rate_limited` |
| `createAgency` | Server Action | unchanged (spec 0005) | unchanged | signed in | adds `rate_limited` after `unauthenticated` and the existing agency short circuit, before any Clerk create |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `consume` | `subject` text | `ctx.orgId` (spec 0003's `StaffContext`) for the wrapper; `clerkUserId` from `sessionClaims()` for `createAgency` |
| `consume` | `action`, `limit`, `windowSeconds` | the declared policy constant (AC-1) |
| `consume` | `now` | `new Date()` taken once in the wrapper (and once in `createAgency`) and passed in, so tests can fix it |
| `consume` | `windowStart` | derived: `windowStart(now, policy.windowSeconds)` (AC-4) |
| `consume` | `count` after this attempt | the upsert's `returning` (AC-3) |
| `consume` | allowed or refused | derived: `count <= limit` |
| `consume` | `retryAfterSeconds` | derived: `windowStart + windowSeconds - now`, in whole seconds rounded up |
| `consume` | the message | `refusalMessage(policy, retryAfterSeconds)`: the noun phrase per policy and the minutes or hours rule with its singular (AC-5) |
| `consume` | `updated_at` | the same `now` passed in, on both branches of the upsert (AC-3) |
| `consume` | the refusal log fields | `subject`, `action`, `count`, `limit`, `windowStart` from the verdict it just built, logged by the door before returning (AC-8) |
| wrapper, `createAgency` | the `rate_limited` result | `failure({ code: "rate_limited", message })` with the verdict's message (AC-2, AC-6) |
| `createAgency` | when to consume | after `existing` is undefined and before `createClerkOrganization` (AC-6) |
| screens | the sentence shown | `errorMessage(error)` (spec 0004's pattern), which prefers `error.message` (AC-14) |
| `retention_prune` | the cutoff | `now - 7 days` on `window_start`, `now` from `SweepInput` (AC-10) |

**Key invariants**:
- One attempt is one increment, always, whatever happens after the check; the count is never decremented and never reset except by the clock and the prune.
- The consume is a single statement, so two concurrent attempts can never both see the same count.
- The check never runs inside a transaction that a later throw could roll back.
- A refused call has no side effect beyond the counter row and the log line: no row inserted, no URL signed, no email sent, no Clerk organization created, no revalidation.
- The door never throws. A failed store is an allowed attempt with a `rate_limit.skipped` line.
- A policy is one of the three exported constants; the type forbids an ad hoc one.
- No log line or message carries personal data; the subject is an id.

**Security model**:
- The agency policies are keyed by `ctx.orgId`, which spec 0003 resolves from the Clerk session, so a caller cannot choose whose allowance is consumed.
- The person policy is keyed by the Clerk user id from the verified session claims.
- Admins and members are equal under every ceiling; there is no bypass role and no reset action (AC-11).
- The table holds ids and counts only, no personal data, so a GDPR erasure has nothing to scrub here.
- Contacts (the read only portal) never reach the limiter; a future public or unauthenticated route that needs an IP keyed ceiling would add a third subject kind with no migration (see Follow-up).

**Configuration required**: none. No environment variable is added, and the two `UPSTASH_*` variables spec 0001 planned are dropped (AC-13).

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: with a fixed `now`, 60 `requestUpload` calls in one agency succeed, the 61st returns `rate_limited` with `Your agency has reached its upload allowance of 60 an hour. Try again in about N minutes.`, no 61st `deliverables` row exists, and a second agency's first call succeeds; verifies **AC-1**, **AC-2**, **AC-3**, **AC-5**.
- Concurrency: 60 parallel `consume` calls against real PostgreSQL leave one row with `count = 60` and all allowed; a 61st is refused; verifies **AC-3**.
- Window boundary: a row at `count = 60` for the hour ending at 14:00 UTC does not affect a call at 14:00:00, which starts a new row at `count = 1`; verifies **AC-4**.
- Failure case: a door whose executor throws returns `allowed`, the action completes, and exactly one `rate_limit.skipped` line is emitted; verifies **AC-7**.
- Transaction: `issueInvoice` refused by the policy issues nothing, sends nothing and consumes no invoice number; an `issueInvoice` allowed but failing inside its own transaction still leaves `count` incremented; a resend inside the cooldown still returns `conflict` with its existing message when the policy allows it; verifies **AC-2**, **AC-3**, **AC-12**.
- Message rounding: 59 seconds reads `in about 1 minute`, 3599 seconds reads `in about 1 hour`, 7201 seconds reads `in about 3 hours`; verifies **AC-5**.
- Person key: a Clerk user with three agencies created today is refused before `createClerkOrganization` is called (the Clerk fake records no call), a `rate_limit.refused` line is emitted by the door, and a retried submit that resolves to an existing agency consumes nothing; verifies **AC-6**, **AC-8**.
- Auth/permission: a member and an admin of the same agency draw from the same row; a signed out caller receives `unauthenticated` and consumes nothing; verifies **AC-2**, **AC-11**.
- Log privacy: the refused and skipped lines match no email address and carry no input field; verifies **AC-8**.
- Retention: the sweep removes an 8 day old row, keeps a 6 day old one, and reports `rate_limit_windows_pruned`; verifies **AC-10**.
- Types: a test file asserting `withTenantAction({ rateLimit: { action: "x", limit: 1, windowSeconds: 1 } })` fails to typecheck, in the style of `accessor.types.test.ts`; verifies **AC-13**.
- Screens: the four screens render the sentence in their existing error region with axe clean, in the `*.test.tsx` style of spec 0011 and spec 0012; verifies **AC-14**.

## Build plan

Tracer Bullet: the first task pushes one refusal all the way from a real `requestUpload` call through the new table and back to the screen, proving the slot, the door, the statement and the message together before the other three actions and the housekeeping are added.

1. [x] **One thread end to end, uploads.** The `rate_limit_windows` schema file, zod entries and migration; `policies.ts` with the three constants; `window.ts` with `windowStart`, `retryAfterSeconds`, `refusalMessage`, the `RateLimitVerdict` type and their unit tests (including the rounding and singular cases); the door in `src/db/tenant/rate-limit.ts` with the upsert setting `updated_at` on both branches; the slot on `withTenantAction` replacing `never` and the check between parse and handler; `requestUpload` declaring `UPLOAD`; the db test that allows 60 and refuses the 61st with the exact sentence and no extra row; the project page showing the sentence in its existing error region. Satisfies **AC-1** (uploads), **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-9**, **AC-13**, **AC-14** (uploads).
2. [x] **The log lines and fail open.** `src/rate-limit/log.ts`, the door calling `logRefused` on every refusal and `logSkipped` from its catch before returning `allowed`, the privacy test over both lines, and the concurrency test with 60 parallel consumes. Satisfies **AC-3**, **AC-7**, **AC-8**.
3. [x] **Invoice emails and agency creation.** `INVOICE_EMAIL` on `issueInvoice` and `resendInvoiceNotification` with the transaction and cooldown ordering tests; `CREATE_AGENCY` in `createAgency` before `createClerkOrganization` with the Clerk fake test; the invoice and onboarding screens showing the sentence. Satisfies **AC-1**, **AC-6**, **AC-11**, **AC-12**, **AC-14**.
4. [x] **Retention, types and verification.** The third delete in `retention-sweep.ts` and its test; the type level test for the slot; run the manual walk (seed a row at the ceiling through SQL, then one real call on each of the four actions) and record it in `verify.md`. Satisfies **AC-10**, **AC-13**.

## Consequences

**Positive**:
- One provider fewer than spec 0001 planned; no new env var, no HTTP hop on the hot path, nothing new to run at 2am.
- Counts are exact under concurrency, which spec 0009's check then write cap is not; the same door can later replace that cap if its off by one ever matters.
- Opting the next action in is one declared field, visible in the config and checked by the type system.
- The worst hour of upload abuse is bounded at 6 GB against a 10 GB tier, and the nightly abandoned sweep reclaims what never finished.

**Negative / tradeoffs**:
- A fixed window lets a burst straddling a boundary reach double the ceiling. At 60 and 50 that is a nuisance, not a breach, and it is accepted rather than paid for with a sliding window.
- A person hitting real errors (a failing R2, a Clerk outage) still spends allowance on each retry, because the attempt is what counts. The ceilings are sized so that only a loop notices.
- Because the wrapper consumes before the handler runs, a shared allowance can be spent by attempts that cost the agency nothing: fifty `issueInvoice` calls with an invalid or already issued invoice id from any `org:admin` or `org:member` exhaust the `invoice_email` window and block every legitimate invoice email for the rest of the UTC day, at a lower cost to the "hostile colleague" the user story names than sending fifty real emails would be. Accepted for the same reason as the retry cost above: `code review, 2026-09-18` flagged it, and moving the consume into the two handlers (so the allowance tracks emails actually attempted rather than calls attempted) was considered and rejected here because it loses AC-13's "one declared field" property for those two actions. Revisit if this shared window is ever seen to bite in practice.
- The daily windows reset at 00:00 UTC, which is mid afternoon for some agencies; the relative wording hides the clock but not the fact. An agency timezone (a deferred scope item) would let the window follow the agency's day.
- One more statement on four actions, one more table to migrate and assert, and a third delete in the nightly prune.

**Neutral**:
- Spec 0001's provider table row for rate limiting now points here; its Upstash follow up is closed by this decision. The `upstash-ratelimit-js` skill stays installed but unused.
- Spec 0017's AC-9 gains a third table; that spec's text was amended when this spec was accepted rather than superseded.
- Spec 0009's invitation cooldown and daily cap stay as they are; they were designed for a different question (when did the last email actually go out) and are not worth reworking to fit this table.
- The deferred scope item "agency creation is not rate limited" is settled by AC-6.

## Follow-up

- [ ] If a public or unauthenticated route ever needs a ceiling (a webhook is signature verified and the cron route has its secret, so none does today), add a third subject kind `ip:<address>` and a policy; the table needs no migration, and the route calls the door directly the way `createAgency` does.
- [ ] Spec 0009's daily cap is check then write and can exceed 50 by one under concurrency. If that ever matters, move it onto this table with an `invitation` policy; the cooldown should stay on `invited_at`, because it measures a successful send rather than an attempt.
- [ ] When feature 20 (error tracking) lands, a `rate_limit.skipped` line is worth surfacing as an alert, since it means the database threw on the hot path.
- [ ] When an agency timezone exists, consider aligning the daily windows to the agency's midnight rather than UTC.
- [ ] `/sync` should retire the spec 0011 follow up "feature 19 should limit `requestUpload`" and the deferred scope item on agency creation once this ships.
