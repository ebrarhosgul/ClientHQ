# Review, feat/clerk-webhook-sync, 2026-09-17

**Reviewed by**: claude-opus-5[1m] (author on an unnamed model)
**Scope**: 23 files + 1 untracked, branch vs `main` (merge base `27852ca`)
**Verdict**: Changes requested

## Summary

Spec 0015's Clerk webhook lands as a faithful second copy of the Stripe webhook's six step shape: verify, resolve identifiers, re read from Clerk outside the transaction, claim the `svix-id` in the ledger, apply, commit. The design is right in the places that matter, no column is ever written from the payload, the ledger row and the mirror change share one transaction, `withSystemAccess` stays confined to the route and the ESLint fence is pinned by `src/payments/fence.test.ts`, and the `setWhere` guards make `deleted_at` genuinely one way at the statement level for both writers rather than by convention. `pnpm typecheck` is clean, `pnpm test` is 3197 green, and `src/auth/webhook.db.test.ts` is 22 green against a real database.

Three things hold it back. `env()` gained a required key without the CI database job's env block gaining it, which will fail that job. `deleteMembershipRows({})` compiles and deletes every membership row in the database. And the suite that proves almost every acceptance criterion in this spec never executes in CI: it is not in the database job's step list, and it skips itself in the unit job. None is deep; all three are the kind of thing that bites on the next push rather than this one.

## Major

### 🟠 The CI database job will fail: `env()` gained a required key the workflow does not set, `.github/workflows/ci.yml:105-118`

**Problem**: `src/lib/env.ts:93` adds `CLERK_WEBHOOK_SIGNING_SECRET` as required with no default. The `migrations-apply` job's `env:` block enumerates every required key as a placeholder precisely because, as its own comment says, "`env()` in src/lib/env.ts parses every required key at once, not only the ones a given test touches". That block was not updated. `src/invoices/invoices.db.test.ts` runs in that job and reaches `env()` through `src/invoices/notify.ts:132-133` (`env().NEXT_PUBLIC_APP_URL`, `env().EMAIL_FROM`), which is the exact reason `EMAIL_FROM` was added to the block earlier.

**Why it matters**: the merge gate goes red on the first push, for a reason that has nothing to do with the test that fails. It is also the failure mode with the worst diagnostic: a Zod parse error naming a Clerk secret, thrown from an invoice notification test.

**Suggested fix**: add `CLERK_WEBHOOK_SIGNING_SECRET: whsec_ci_placeholder` to the `migrations-apply` job's `env:` block, beside `STRIPE_WEBHOOK_SECRET`. Confirm the same for any Vercel environment before this deploys, since `env()` throws for every request once the key is required.

### 🟠 `deleteMembershipRows({})` deletes every membership row in every tenant, `src/db/tenant/provisioning.ts:277-291`

**Problem**: both fields of the input are optional, and the body builds its predicate with `and(...conditions)`. Drizzle's `and()` returns `undefined` when the filtered condition list is empty (`node_modules/drizzle-orm/sql/expressions/conditions.js`), and `.where(undefined)` emits an unqualified `DELETE FROM memberships`. Nothing in the type, and nothing at runtime, stops `deleteMembershipRows({})`; the doc comment states the invariant ("At least one of the two is always given") without enforcing it.

**Why it matters**: this lives in the one layer that has no tenant scoping to fall back on, and it is called from a webhook handler where a future refactor could easily pass through an object whose fields are both `undefined` (for instance, threading `{ orgId: result?.orgId }` from a lookup that returned nothing). The blast radius is every agency's membership rows at once, and the rows are hard deleted, so recovery means a restore.

**Suggested fix**: make the shape unrepresentable rather than documented. A discriminated input (`{ orgId: string } | { userId: string } | { orgId: string; userId: string }`) covers all three current call sites without a cast, and a `conditions.length === 0` throw as a runtime backstop costs nothing. The three existing tests in `src/db/tenant/provisioning.db.test.ts:576-674` should gain a fourth asserting the empty input is refused.

### 🟠 The suite that proves the feature never runs in CI, `src/auth/webhook.db.test.ts:379`

**Problem**: the file is `describe.skipIf(!url)` on `DIRECT_URL`. The `checks` job runs `pnpm test` with no `DIRECT_URL`, so it skips there. The `migrations-apply` job runs six named `pnpm vitest run <file>` steps (`.github/workflows/ci.yml:150-187`) and this file is not among them, nor are `src/db/tenant/context.db.test.ts` and `src/db/tenant/provisioning.db.test.ts`, which carry the new AC-7 and AC-8 cases. So the 22 cases covering AC-1 through AC-13, including signature verification, replay, rollback and the concurrency claim, execute only on a developer's machine. Spec 0015's own follow up (line 194) asserts the opposite: "the `webhook.db.test.ts` here runs in the unit job against the throwaway PostgreSQL like `src/payments/webhook.db.test.ts`".

**Why it matters**: the author's decision to fold the planned fake-`db` unit file into the real-PostgreSQL file (scope.md now records this as "skipped by design") is defensible on its merits, but it only holds if that file actually runs. As it stands, a regression in the handler's ordering, refusal or rollback behaviour passes CI silently. `src/payments/webhook.db.test.ts` is wired in; its sibling is not.

**Suggested fix**: add a step to the `migrations-apply` job running `src/auth/webhook.db.test.ts`, and the two touched `src/db/tenant/*.db.test.ts` files with it. The wider gap (10 of 16 `*.db.test.ts` files are unwired) predates this branch and is worth its own pass, but the three this branch depends on should not ship unwired.

## Minor

### 🟡 A concurrent second `user.deleted` can move `deleted_at` forward, `src/auth/webhook.ts:228-266`

**Problem**: the branch reads `users.deletedAt` with a plain `select` (no `for update`), then calls `scrubUser()`. Two deliveries in flight can both read `deletedAt === null`; the loser then re-runs the scrub after the winner commits, writing a fresh `deleted_at`. The organization path avoids exactly this with `coalesce(deleted_at, now())` in `softDeleteOrganization`.

**Why it matters**: it contradicts the spec's own key invariant ("`deleted_at` ... only ever moves from null to set") and AC-9's "an already scrubbed row answers handled with no change". The practical damage is small (the row is scrubbed either way, the timestamp shifts by milliseconds), but the erasure timestamp is the audit trail the security model leans on.

**Suggested fix**: give `scrubUser`'s update the same `coalesce` treatment for `deleted_at`, or add `isNull(users.deletedAt)` to its `where` and treat an empty `returning` as "already scrubbed".

### 🟡 The 500 log line carries an unbounded driver message, `src/auth/webhook.ts:546`

**Problem**: the catch-all puts `thrown.message` straight into `reason`, which `answer()` logs. AC-14 says the line never carries "any part of the payload", and `src/auth/webhook-log.ts`'s own header promises "never a payload, an email address, a name or an image URL". A PostgreSQL constraint message or a Zod issue string is not under this code's control and can quote a column value; `users.email` is one of the columns this handler writes.

**Why it matters**: the one log line this feature emits on failure is also the one place personal data could leak into logs, and `webhook-log.test.ts:91` only proves the logger does not add such fields itself, not that callers do not pass them in.

**Suggested fix**: log a fixed reason for the catch-all (`apply_failed`) plus the error's `name`, and send the full error to Sentry when feature 20 lands, rather than into the structured line.

### 🟡 The unscoped door opens before the signature is checked, `src/app/api/webhooks/clerk/route.ts:31`

**Problem**: `withSystemAccess` wraps the whole handler, so `logSystemAccess()` writes an audit line and a pooled connection is resolved for every request that reaches this public route, including unsigned ones. Verification happens inside, at `src/auth/webhook.ts:479`.

**Why it matters**: anyone who can POST to the endpoint can pad the "unscoped database access was granted" audit trail, which is the one log the tenant isolation story asks a reviewer to trust. The spec declines rate limiting on the grounds that "every request that reaches the handler carries a valid signature", which is not quite what the code does.

**Suggested fix**: not blocking, and the Stripe route has the same shape, so change both or neither. If it is left as is, the reasoning belongs in a comment on the route rather than only in the spec.

### 🟡 `MirrorUserDeleted` escapes `acceptInvitation` as a raw throw, `src/db/tenant/invitation.ts:202`

**Problem**: `ensureUserRow` used to throw an unreachable "Provisioning wrote no user row."; after the `setWhere` guard the throw is genuinely reachable, and this caller neither catches it nor folds it into its `AcceptOutcome` union. Every other expected failure in that function is returned as a value.

**Why it matters**: a person in this state gets an unhandled Server Action error rather than the refusal the surrounding code is built to render. It is rare (a scrubbed row implies Clerk deleted the account, which revokes the session), but the project rule is explicit that expected failures are values.

**Suggested fix**: catch `MirrorUserDeleted` in `acceptInvitation` and return `{ kind: "refused", ... }`, or add a dedicated outcome. Spec 0015 says existing callers keep their signature, which this does.

### 🟡 The `unique_violation` branch is untested, `src/auth/webhook.ts:532-537`

**Problem**: AC-12 pins "a unique violation during apply is answered `200` with outcome `refused` and reason `unique_violation`, never `500`". `isUniqueViolation` is a structural check on a driver-specific `code`, and nothing in the suite exercises it (the string appears only in the two handlers). The realistic trigger, a `organizations.slug` collision between `freeSlug()` and a concurrent onboarding insert, is reachable.

**Suggested fix**: one case in `webhook.db.test.ts` that pre-seeds a colliding slug and asserts `200` / `refused` / `unique_violation`, and that no ledger row survives.

### 🟡 `freeSlug()` runs on every organization upsert, including the common update, `src/db/tenant/provisioning.ts:169-175`

**Problem**: `upsertOrganizationRow` computes a free slug before every statement, which is a `SELECT ... WHERE slug = $1 OR slug LIKE $2` over `organizations`, even though `slug` is never in the update set. This is inherited from `upsertMirror`, but it has moved from a once-per-onboarding path onto the per-delivery webhook path, and it now runs inside the transaction that also holds the organization row lock.

**Suggested fix**: not urgent at this product's volume. If it is touched, compute the slug lazily (only when the insert is actually needed) or accept the extra round trip knowingly and say so in the comment.

### 🟡 `.vercelignore` is untracked, unexplained and unrelated to this spec

**Problem**: the new file ignores `node_modules`, `.next`, test output directories and `.git`. Nothing in spec 0015, the scope entry or the commit series mentions it, and `vercel.json` plus `.github/workflows/migrate.yml` show production deploys go through a deploy hook rather than a CLI upload, so it is not obvious what this file is for or whether ignoring `.git` and `.next` is safe for whatever path does use it.

**Suggested fix**: either commit it with a one line comment saying which deploy path it serves, or drop it from this branch. It should not ride along untracked in a webhook PR.

## Nits

- ⚪ `src/auth/webhook.ts:493`, `verifyWebhook` trims the `svix-id` header before signing over it; this reads it raw. Harmless (a retry repeats the same bytes) but the ledger key and the verified key can differ by whitespace.
- ⚪ `src/auth/webhook-log.ts:63`, `console.warn` for the organization delete, which is a `handled` outcome, not a warning. Matches `src/payments/log.ts`, so change both or neither.
- ⚪ `src/auth/webhook.ts:228-236`, a stranger answers `ignored` but still commits a ledger row. Correct (the delivery was acted on), but the comment says "nothing is written", which reads as including the ledger.
- ⚪ `src/auth/webhook.ts` is 551 lines, roughly a third of it prose. The prose is genuinely good, but the six step narrative at the top now duplicates the spec's Feature design section closely enough that the two will drift.

## Strengths

- The re read is the trust boundary, not the payload, and the code holds that line everywhere: `referenceOf` parses identifiers only, and every column written comes from `mirrorOrganizationRead` / `mirrorUserRead` / `membershipRoleRead`. The "reverse order deliveries converge" property falls out of that for free, and the test at `webhook.db.test.ts:519` proves it.
- The `setWhere: isNull(...)` guards on both upserts are the right mechanism for the "`deleted_at` only moves one way" invariant: it is enforced by the statement both writers share, so onboarding cannot revive a scrubbed row either. The `MirrorUserDeleted` / `"deleted"` split (throw where one catch block suffices, value where two paths need it) is a deliberate, well argued asymmetry.
- `webhook.db.test.ts` signs every delivery for real through the same `verifyWebhook` the route calls instead of mocking it away. That is the difference between testing AC-1 and asserting it, and it is rare to see.
- `withSystemAccess` handling is exactly right: one short route file, a real reason string, the handler taking `db` as an argument so it is testable without the door, and `src/payments/fence.test.ts` updated to pin the importer list at three.
- AC-7 closes a genuine pre-existing hole (a soft deleted agency still served its client portal), and `context.db.test.ts` covers the interesting case, a person holding contacts in both a live and a deleted agency, not just the easy one.
- `.env.example` moves the key into the required block with the dashboard prerequisites and the local relay command spelled out. Someone setting this up from scratch will not have to guess.

## Test coverage

Strong in substance, weak in where it runs. 22 real-PostgreSQL cases cover verification, the eight event filter, replay, out of order delivery, all three object kinds, both refusals, the cascades, the rollback and the concurrency claim; `webhook-events.test.ts` covers both trust boundaries including the `null` vs `undefined` distinction; `webhook-log.test.ts` covers the redaction promise; `route.test.ts` covers the wiring with a database handle that throws on any access; `env.test.ts` and `fence.test.ts` pin the new key and the importer list. The folding of the planned fake-gateway unit file into the database file is a reasonable call and is recorded in scope.md.

Gaps: the database suites are not wired into CI (Major above), so most of that proof is dormant there; the `unique_violation` branch of AC-12 has no test; `deleteMembershipRows`'s empty input has no test because it has no guard; and the concurrent re-scrub race in `applyUserEvent` is not exercised by the concurrency case, which only covers the organization row.
