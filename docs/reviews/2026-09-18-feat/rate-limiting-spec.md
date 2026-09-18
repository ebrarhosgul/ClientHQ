# Review, feat/rate-limiting-spec, 2026-09-18

**Reviewed by**: claude-opus-5[1m] (author on a different model)
**Scope**: 37 files, branch vs `main` (merge base `122fd40`)
**Verdict**: Changes requested

## Summary

Spec 0018 lands a Postgres-backed rate limiter: three `as const` policies, a pure
window/message module, one atomic upsert behind a named door in the tenant layer, a
declarative `rateLimit` slot on `withTenantAction`, a direct call in `createAgency`,
and a seven day prune in the nightly `retention_prune` sweep. The design is faithful
to the spec, the code is clean and well commented, and `typecheck`, `lint`,
`format:check` and the unit suite all pass locally (182 tests across the touched
files). The headline problem is not the production code but the one test that is
supposed to prove the feature's central safety claim: the "60 parallel consumes"
test cannot be concurrent, because `pooledDb()` is the app handle capped at one
connection, so a regression from the atomic upsert back to a read-then-write would
sail past it. Two smaller gaps follow from the same "the counter is consumed before
the handler" ordering and from `db:schema:assert` not actually asserting the primary
key the upsert depends on.

## Major

### 🟠 The concurrency test does not exercise concurrency, `src/db/tenant/rate-limit.db.test.ts:105`

**Problem**: The test fires `UPLOAD.limit` `consume()` calls through `Promise.all` and
its file header states they arrive "from separate connections the way separate
serverless invocations would". They do not. `consume` reaches the database through
`pooledDb()` (`src/db/tenant/rate-limit.ts:59`), which returns the shared handle from
`src/db/client.ts:43-47`, created with `max: 1`. postgres-js queues every statement
onto that single connection, so the 60 upserts execute strictly one after another.
The test's own `sql` client with `max: 5` is only used for the `select`/`delete`
assertions, not by the code under test.

**Why it matters**: AC-3's concurrency guarantee — "two concurrent attempts can never
both see the same count" — is the single invariant that makes this feature a real
ceiling rather than an approximation, and it is the reason a database test was written
instead of a mock. As written, the test passes identically if someone rewrites the
door as `select count` then `update count = <read value> + 1`: the serialised
execution hides exactly the race the test exists to catch. The suite therefore
reports coverage of AC-3 that it does not have, and `verify.md` records that claim as
verified.

**Suggested fix**: Have the concurrency case drive real parallelism rather than the
app pool. Either give the test its own multi-connection handle and a locally
constructed equivalent of the upsert, or temporarily point the mocked `./executor`
`pooledDb` at a `postgres(url, { prepare: false, max: 10 })` client for that test only
(the existing db tests already mock `@/db/tenant/executor`, so the seam exists). Then
correct the file header, which currently asserts something the code does not do.

## Minor

### 🟡 `db:schema:assert` never checks the primary key the whole mechanism rests on, `scripts/db-schema-assert.ts:62,161`

**Problem**: The new table is added to `TABLES` and to `INDEXES`, so the script proves
`rate_limit_windows` exists and carries `rate_limit_windows_window_start_idx`. It
does not prove the composite primary key: the script's constraint checks cover only
kinds `u` (unique), `c` (check) and `f` (foreign key) — `UNIQUE_CONSTRAINTS` at line
82 has no entry for this table and there is no primary-key assertion anywhere.
`docs/specs/0018-rate-limiting/verify.md` nonetheless records the step as
"`rate_limit_windows`, its primary key and its `window_start` index are live with the
right column types".

**Why it matters**: `onConflictDoUpdate` needs that unique index to exist. If it is
ever absent (a partially applied migration, a hand-repaired database, a future
migration that rebuilds the table), every `consume` throws, the `catch` in
`src/db/tenant/rate-limit.ts:80` swallows it, and the limiter silently ceases to exist
— fail-open by design, with nothing but a `rate_limit.skipped` warn line to notice.
That is precisely the failure this script is meant to catch before it reaches
production, and AC-9 names the primary key as part of the contract.

**Suggested fix**: Add a primary-key assertion (`pg_constraint.contype = 'p'`,
columns `subject, action, window_start`) to the script, or at minimum add the triple
to `UNIQUE_CONSTRAINTS` so the existing unique check covers it. Adjust the `verify.md`
line so it only claims what the script proves.

### 🟡 A member can burn the agency's whole daily invoice-email allowance without sending one email, `src/db/tenant/action.ts:220-230`

**Problem**: The wrapper consumes before the handler runs, so a unit is spent on every
attempt that later refuses for a reason that costs nothing: an unknown invoice id
(`not_found`), a non-draft invoice (`conflict`), or unconfigured storage in
`requestUpload` (`src/deliverables/request-upload.ts:36`). Fifty `issueInvoice({ id:
<random uuid> })` calls from any `org:member` exhaust the shared `invoice_email`
window and block every legitimate invoice email for that agency until 00:00 UTC.

**Why it matters**: AC-3 does say an attempt counts "whether the attempt is then
allowed, refused, or allowed but fails later", and Consequences acknowledges that
retries against real errors cost allowance — so this conforms to the spec. But the
spec's own user story is "a hostile colleague", and this ordering hands that colleague
a cheaper, more effective attack (deny all invoicing for a day at a cost of 50
requests) than the one the ceiling was built to stop. It is worth a deliberate
decision rather than a side effect of where the check sits.

**Suggested fix**: Either record it in the spec's Consequences / Follow-up as an
accepted tradeoff, or move the `invoice_email` consume out of the wrapper and into the
two handlers just before `notifyInvoiceContacts`, so the allowance tracks emails
actually attempted rather than calls attempted. The latter loses the "one declared
field" property for those two actions, so it is a genuine tradeoff, not an obvious
win.

### 🟡 AC-14 has no automated coverage, and one screen bypasses `errorMessage()`, `src/deliverables/ui/upload-deliverable.tsx:221`

**Problem**: No `.tsx` or `.test.tsx` file changed on this branch, yet AC-14 and the
spec's "Screens" critical-test scenario call for the sentence to render in each
screen's existing error region with axe clean. The behaviour does work today because
`errorMessage()` prefers `error.message`, but nothing pins it. The invoice screens go
through `ActionErrorMessage` → `errorMessage()`; the upload picker instead does
`setMessage(result.error.message)` directly, so it never falls back to the
`rate_limited` map sentence if a refusal ever arrives with an empty message.

**Why it matters**: `TESTS = configured`, and this is user-visible behaviour a new
error code silently inherits. A future change to the refusal message shape (or to
`errorMessage`'s precedence) breaks the four screens with no failing test.

**Suggested fix**: Add one case to `src/deliverables/ui/upload-deliverable.test.tsx`
and `src/invoices/ui/invoices-ui.test.tsx` asserting the `rate_limited` sentence
lands in the alert region. Separately, have the upload picker render
`errorMessage(result.error)` like every other form, so an empty message can never
produce a blank alert.

### 🟡 The prune materialises every deleted row just to count it, `src/cron/retention-sweep.ts:44-47`

**Problem**: `.returning({ subject: rateLimitWindows.subject })` pulls every pruned row
back into memory so `.length` can be read.

**Why it matters**: This copies the pattern used for `cron_runs` and
`processed_webhook_events`, but the cardinality is not comparable: `rate_limit_windows`
gets up to 24 hourly upload rows plus two daily rows per agency per day, plus a row
per person creating an agency. Seven days at a few thousand agencies is hundreds of
thousands of rows returned over the wire in one statement, inside a cron route with a
300s budget. It will not bite today; it will bite quietly at scale.

**Suggested fix**: Use the driver's affected-row count rather than `returning` for
this delete (and consider the same for the other two while you are there), or bound
the delete with a `limit`-style batched loop if the count must stay exact.

## Nits

- ⚪ `src/rate-limit/window.ts:56-64`, `resetPhrase` derives hours from the raw seconds
  rather than from the remaining minutes, so 3601 seconds (1h 0m 1s) reads "in about 2
  hours" and 7201 seconds reads "in about 3 hours". It matches AC-5's stated formula
  and errs on the safe side, but it overstates the wait by up to 59 minutes.
- ⚪ `src/db/tenant/rate-limit.ts:48`, `let count: number;` assigned across a
  `try`/`catch` is the one mutable local in the feature; returning the verdict from
  inside the `try` (and the fail-open verdict from the `catch`) keeps to the project's
  "use `const`" rule without changing behaviour.
- ⚪ `src/rate-limit/log.ts:57`, the refusal line writes `windowStart` while AC-8 names
  the field `window_start`. camelCase matches `webhook-log.ts`, so the implementation
  is right and the spec text is the thing that is off by a convention.
- ⚪ `src/rate-limit/window.ts:40-43`, `windowStart` floors against the epoch, not the
  clock. That is identical to clock alignment only because 3600 and 86400 both divide
  the epoch evenly; a future policy with, say, `windowSeconds: 2700` would silently
  stop matching the docstring's "aligned to the UTC clock".
- ⚪ `scripts/db-schema-assert.ts:65-69`, the docstring still says "the three tables
  with no tenant to hold" and lists three; `rate_limit_windows` makes it four.
- ⚪ `src/rate-limit/log.ts:59`, `logSkipped` records only `error.name`, which for a
  plain `throw new Error(...)` is just `"Error"`. The `row === undefined` guard in the
  door throws exactly such an error, so a genuine bug there is indistinguishable from
  a connection failure in the logs. A short, allow-listed reason code would cost no
  privacy.
- ⚪ `src/auth/agency.ts:132-136`, the `consume` call sits inside `withClerk`'s
  try/catch. `consume` is documented never to throw so this is safe today, but if that
  ever changed the person would be told "We could not reach the accounts service",
  which would be untrue.
- ⚪ `docs/specs/0018-rate-limiting/verify.md`, the onboarding UI step is ticked `[x]`
  and then says "not directly observed" in the same line. The reasoning is honest and
  well argued; the checkbox still overstates it.

## Strengths

- The door is the right shape. One statement, `count = count + 1` against the row the
  other caller just wrote, `returning` the post-increment count, and `count <= limit`
  as the whole decision — no read-then-write anywhere, and the doc comment explains
  *why* rather than *what*.
- All logging lives in the door rather than at the two call sites, so no future caller
  can forget to log a refusal. `src/db/tenant/index.ts:146-150` says so explicitly.
- `RateLimitPolicy` as the union of three literal types (not a structural
  `{ action, limit, windowSeconds }`) is a genuinely good use of the type system, and
  `action.types.test.ts` pins it with `@ts-expect-error` on both an unknown action and
  a real action with the wrong limit. That second case is the one most people would
  miss.
- `action.test.ts:506-597` tests the ordering by behaviour, not by mocks: no consume on
  a validation failure, none on a role refusal, and on a refusal no handler call, no
  transaction opened and no revalidation. That is exactly AC-2's contract.
- `window.ts` takes `now` as a parameter throughout, so the arithmetic tests need
  neither a clock nor a database. The boundary and singular/plural cases are all
  covered.
- The documentation trail is unusually good: spec 0001's provider table and follow-up,
  spec 0017's AC-9, `.env.example` and `docs/scope/scope.md` were all amended in the
  same change, so the retired Upstash plan leaves no stale claim behind.

## Test coverage

Strong in breadth, with one hole at the most important point. Covered: the pure
window/message arithmetic including the rounding and singular rules
(`window.test.ts`); the exact log envelopes via `toStrictEqual`, which is the right
call given the partial matches elsewhere (`log.test.ts`); the literal policy numbers,
which nothing else pins (`policies.test.ts`); fail-open with the real error name
(`rate-limit.test.ts`); wrapper ordering and the no-side-effect refusal
(`action.test.ts`); the type-level slot (`action.types.test.ts`); end-to-end refusals
against real PostgreSQL for uploads and invoices, including the shared allowance and
the ceiling-before-cooldown ordering; `createAgency`'s call ordering, its
no-Clerk-call refusal and the free double submit; and the seven day prune with a
6-day-old row surviving.

Not covered: AC-3's concurrency claim, which has a test that cannot be concurrent
(Major above); AC-14, which has no screen test at all and no code change to inherit
one from; and `rate_limit_windows`' primary key, which `db:schema:assert` does not
assert despite `verify.md` saying it does. Everything that does run passes:
`pnpm typecheck`, `pnpm lint`, `pnpm format:check` and 182 unit tests across the eight
touched non-database test files.
