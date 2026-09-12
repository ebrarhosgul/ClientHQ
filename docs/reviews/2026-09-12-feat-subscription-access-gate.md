# Review, feat/subscription-access-gate, 2026-09-12

**Reviewed by**: Claude Sonnet 5 (author on Claude Opus)
**Scope**: 67 files, branch vs base (main, merge base 167f6ff)
**Verdict**: Approve with nits

## Summary

This is the subscription access gate from spec 0008: a pure function (`accessVerdict`) turns a `subscriptions` row plus the clock into one of four access levels, applied to reads via a new `(gated)` route group layout and to writes via a `requireFullAccess()` guard wired into `withTenantAction()`. The implementation matches the spec closely — every acceptance criterion I checked is satisfied in the code, the fences (`fence.test.ts`, `routes.test.ts`) pin the two things a future change could quietly break (the opt-out list and the route group membership), and the test suite is unusually thorough: the full status table, the exact 7-day boundary in both directions, the invariant-break case, ordering of checks in the wrapper, fail-closed behavior on a database error, and axe in both themes for every new surface. I found no correctness or security bugs. The one real finding is a minor, easily fixed duplicate read on `/billing`.

## Minor

### 🟡 `/billing` reads the same subscription row twice per render, `src/app/(agency)/billing/page.tsx:55-64`
**Problem**: `BillingPage` calls both `subscriptionForAgency(ctx)` (spec 0007, selects the full row) and `agencyAccess()` (spec 0008, which internally does its own `tenantDb(ctx).findFirst(subscriptions)` for `status`/`pastDueSince`). These are two distinct functions, each independently `cache()`-wrapped or not; React's `cache()` memoizes per function reference, not per underlying query, so calling both on the same request issues two separate `select`s against the exact same row instead of one.
**Why it matters**: It's a small, indexed read, so the cost is low, but it's pure duplication on the one page that renders on every "come back from Stripe" trip and every locked-agency redirect landing. It also slightly undercuts the spec's own framing of the gate as "one extra indexed read per agency page request" (Consequences, Negative) — `/billing` gets two.
**Suggested fix**: Either derive `billingView`'s status/date fields and the access level from one shared row read (e.g. have `agencyAccess()` accept an optional pre-fetched row, or have the page compute `accessVerdict` itself from the row `subscriptionForAgency` already fetched, using the same pure function `agencyAccess()` calls), or accept it explicitly as a documented exception the way the rest of the tradeoffs section does.

## Nits

- ⚪ `src/app/(agency)/billing/page.tsx:61-64`: `isAdmin` is derived from `ctx?.role`, and `access.role` (from `agencyAccess()`) is the same value resolved a second time via the same cached `agencyContext()`. Not a bug (both trace back to the one cached context), just a small redundancy worth a comment or a single derivation if it's touched again.
- ⚪ `src/access/level.ts`: the exhaustive switch's `default` branch assigns to a `never`-typed `unreachable` and returns it — a nice pattern, consistent with the rest of the codebase's exhaustiveness checks; no change needed, just noting it's used correctly here as elsewhere.

## Strengths

- The pure/impure split is exactly right: `accessVerdict` (pure, in `src/access/level.ts`) never touches the database or Stripe and is exhaustive over `SubscriptionStatus`, while the two effectful callers (`agencyAccess()`, `requireFullAccess()`) share it and each independently log the invariant break. `gate.test.ts` even asserts `stripeClient` is never touched.
- Fail-closed is enforced and tested at every layer: a thrown database error propagates through `agencyAccess()`, `requireFullAccess()`, and the wrapper (never caught into a `Result`), and lands in the new `src/app/(agency)/error.tsx` boundary placed correctly above the `(gated)` layout so a failed gate read never renders a blank page with full access.
- The two fences (`src/app/(agency)/(gated)/routes.test.ts` and `src/payments/fence.test.ts`) check the *repository*, not a hand-typed list — the route test walks the filesystem against `ALL_NAV`, and the opt-out test greps the whole `src/` tree for `subscription: "any"`. Both fail loudly if a future PR moves a page into or out of the gated group, or adds a third opt-out action, which is precisely the kind of invariant that erodes silently otherwise.
- `gate.db.test.ts` runs real SQL in a rolled-back transaction and asserts every statement the gate emits is a `select`, plus proves cross-tenant isolation (an agency with no row stays `unsubscribed` even while a second agency's row says `active`) — this is a stronger proof than the mocked unit tests alone.
- `withTenantAction()`'s check ordering (resolution → role guard → subscription gate → parse) is both documented in the docstring and pinned by dedicated tests (`action.test.ts`: locked member gets `forbidden` not a billing hint; locked admin with invalid input gets `subscription_inactive` not `validation`; a refused write opens no transaction), matching the spec's stated contract exactly.
- Accessibility work is complete rather than token: both `GraceBanner` and `LockedNotice` are region landmarks named by their own heading, the grace banner's countdown is a real `<time datetime>` element, axe runs in both themes for every new component and both `/billing` and the error boundary, and a keyboard-tab test confirms the one interactive element is reachable.

## Test coverage

Coverage is comprehensive and matches `TESTS = configured` expectations well above the bar: the pure function's full truth table and boundary (`level.test.ts`), the cached read in isolation and against real PostgreSQL (`gate.test.ts`, `gate.db.test.ts`), the write-side guard's refusal/logging/ordering (`subscription.test.ts`, `action.test.ts`), the two structural fences (`routes.test.ts`, `fence.test.ts`), every new UI surface with axe in both themes (`grace-banner.test.tsx`, `locked-notice.test.tsx`, `action-error.test.tsx`, `error.test.tsx`), and the seed/gallery additions that make the grace state reachable in development. I did not find untested branching, error-handling, or security-relevant logic in the diff. The only gap is the one the spec itself documents and works around: `verify.md` notes two manual member-session steps couldn't be driven live (only one real Clerk account exists in the dev environment) and are covered instead by the component tests' member-variant assertions — a reasonable substitution, not a coverage hole in the code itself.
