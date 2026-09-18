# Review, feat/product-analytics-error-tracking-spec, 2026-09-18

**Reviewed by**: claude-opus-5 (author model unrecorded; built by `/develop`)
**Scope**: 134 files, branch vs `main` (merge base `875db62`)
**Verdict**: Blocked

## Summary

Spec 0019 lands Sentry in all three runtimes and a server-first PostHog catalogue, with consent, a `/privacy` notice, erasure and a nightly retry sweep. The shape of it is genuinely good: the property type system makes "no free strings" a compile error, the funnel fires inside or right after the transactions that make it true, and the tenant layer is untouched. Typecheck, lint and format are clean, and the unit suite is broad and honest (3580 passing; four `.db.test.ts` failures in a full run are pooler flake and pass in isolation).

The privacy claims, however, do not fully hold in the two places that matter most. `scrubEvent` strips `query_string` but keeps `request.url`, which the SDK populates with the full URL — so a live client-invitation token from `/portal/accept?token=…` reaches Sentry on any error on that page. A second, smaller leak path is `posthog-js`'s auto-collected `$referrer`, which the catalogue's type rule never sees. Beyond that, AC-20's `analytics.erasure_failed` line is never emitted (the function is dead code), and several analytics reads run un-guarded inside action handlers, so a database blip during reporting can turn a committed action into a failure result — the exact thing AC-21 forbids.

## Blockers

### 🔴 `scrubEvent` keeps the full request URL, so invite tokens reach Sentry, `src/observability/sentry-scrub.ts:17-27`

**Problem**: `KEPT_REQUEST_FIELDS = ["url", "method"]` keeps `request.url` verbatim. In the installed SDK (`@sentry/core@10.75.0`, `build/cjs/utils/request.js:52-54`) `url` is `req.url` — the full URL including the query string — and `query_string` is a *separate, additional* field extracted from it. Dropping `query_string` therefore removes the copy and leaves the original. The browser SDK sets `request.url` from `location.href`, with the same result. Breadcrumbs are filtered only for `category === "console"`, so `navigation`, `fetch` and `xhr` breadcrumbs carry query-bearing URLs too.

**Why it matters**: `/portal/accept?token=<raw invite token>` (`src/app/portal/accept/page.tsx:20-30`) carries a live credential that grants a client contact access to another tenant's portal data, and the sign-in `redirect_url` chain carries it a second time. Any error on that page — or any navigation breadcrumb captured on a later error in the same session — ships that token to Sentry, where it sits for the provider's retention window. This contradicts AC-4 and key invariant 7 ("a Sentry event never carries … query strings") and turns error tracking into a credential store.

**Suggested fix**: In `scrubRequest`, reduce `url` to origin plus pathname (parse it and drop `search` and `hash`, falling back to dropping the field entirely if it will not parse). Extend the breadcrumb filter to strip or reduce any URL a breadcrumb carries (`breadcrumb.data.url`, `data.from`, `data.to`) rather than only dropping console breadcrumbs with an `@`. Add the accept-page URL to `sentry-scrub.test.ts` as a case, so the rule is pinned by a test rather than by this review.

## Major

### 🟠 AC-20's `analytics.erasure_failed` log line is never written, `src/observability/log.ts:50`, `src/analytics/client.ts:162-172`

**Problem**: `logErasureFailed` is exported, typed and unit-tested, but no production code calls it (`grep` finds only the definition, the barrel export and its own test). The only failure path, `createAnalytics().deletePerson`, logs `logAnalyticsFailed("deletePerson", thrown)` instead — a line that carries the string `"deletePerson"` and the error class, but **not** the Clerk user id. The sweep in `src/cron/analytics-erasure.ts:49-56` likewise only increments `persons_failed`.

**Why it matters**: AC-20 requires the line by name, and it is the only record of *which* person's provider-side erasure did not complete. Without the id, an operator facing a GDPR erasure complaint cannot answer it from the logs; after the seven-day sweep window closes, the retry stops and nothing remains. It is also dead code with a test that asserts it works, which is the kind of coverage that reads as safety and is not.

**Suggested fix**: Have `deletePerson` (or the two call sites plus the sweep) emit `logErasureFailed(clerkUserId, thrown)` on failure, and keep `analytics.failed` for the non-erasure calls. Assert the line in `analytics-erasure.test.ts`.

### 🟠 Analytics reads inside action handlers can fail a committed action, `src/team/change-team-member-role.ts:111-117`, `src/team/remove-team-member.ts:97`, `src/auth/agency.ts:173-176`, `src/db/tenant/action.ts:194-213`

**Problem**: `identifyPerson` and `identifyAgency` are awaited inline, and both do real database reads (`personCreatedAt`, `agencyAnalyticsSnapshot`) with no `try` of their own — only the *provider* call underneath is swallowed. In `changeTeamMemberRole` and `removeTeamMember` the await sits inside the handler, so a thrown read is converted by `toActionError` into a failure `Result` although Clerk and the mirror have already been written. In `createAgency` it sits after the `try`, so a throw rejects the Server Action outright although the agency exists. Separately, `fireTrack` calls `track.when(...)` and `track.properties(...)` outside any guard (`action.ts:203-211`), so a throwing derivation function fails an action whose transaction has already committed.

**Why it matters**: AC-21 and key invariant 8 say a provider failure, timeout or missing key never changes an action's result. Here the failure mode is worse than a lost event: the person is told their role change or agency creation failed when it succeeded, and will retry.

**Suggested fix**: Wrap `identifyPerson` / `identifyAgency` internals in the same swallow-and-log shape the analytics client uses (or have both return `void` from a `try`), and wrap the `when` / `properties` invocation in `fireTrack` in a `try` that logs `analytics.failed` and skips the event. Where the read is not needed for correctness, prefer scheduling it through `afterResponse` as the portal and onboarding paths already do.

### 🟠 `posthog-js` auto-collected properties bypass the catalogue's "no free string" rule, `src/analytics/browser.ts:50-68`

**Problem**: `init` disables autocapture, recording, surveys, heatmaps and the rest, and `capturePageview` overrides `$current_url` with the reduced URL. It does not set `property_denylist` or `sanitize_properties`, so `posthog-js` still attaches its default event properties — including `$referrer`, `$referring_domain`, `$initial_referrer` and `$initial_current_url` — computed from `document.referrer` and `location`, not from the catalogue.

**Why it matters**: `/portal/accept?token=…` is excluded from tracking as a *page*, but a person who lands there and then navigates to `/onboarding` sends a `$pageview` whose `$referrer` is that URL, token and all. More generally, AC-9's catalogue test and the `NoPlainString` type — the two things `/privacy` points at when it says "a test in the codebase fails if an event ever declares one" — do not cover a single browser-side property, which weakens the claim the page makes to users.

**Suggested fix**: Pass `property_denylist` for the referrer and initial-URL properties, or a `sanitize_properties` hook that reduces any URL-shaped value to origin plus pathname, and add a unit test in `provider.test.tsx` asserting the captured property bag contains nothing beyond the declared set.

## Minor

### 🟡 `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is read but never declared, `src/instrumentation-client.ts:23`

The browser release tag reads a variable that is in neither `src/lib/env.ts` nor `.env.example`, while its server twin `VERCEL_GIT_COMMIT_SHA` is in both. That breaks the AGENTS.md rule that the schema is the one list of everything the app reads, and quietly makes AC-23's "eleven variables" twelve. Declare it beside the others (and mention it in the `.env.example` Vercel block), or read the non-public name if Vercel exposes it to the client bundle here.

### 🟡 `process.env.NODE_ENV` read directly in the consent action, `src/analytics/consent.ts:42`

Every other observability read goes through `observabilityEnv()`, which exists precisely as the documented exemption and already exposes `nodeEnv`. This one bare read is inconsistent and outside the two exemptions the spec names.

### 🟡 `tracesSampleRate` and `tracesSampler` are both set, `src/observability/sentry-options.ts:55-56`

When a `tracesSampler` is present the SDK ignores `tracesSampleRate`, so the constant is decorative and a future reader may change it expecting an effect. Keep the sampler and drop the rate, or comment why both are passed.

### 🟡 A boundary reports only its first error, `src/ui/patterns/use-reported-error.ts:29-33`

`useState(() => …)` runs once per mounted component instance. When `reset()` re-renders the same boundary and the segment fails again with a different error, nothing is captured and the UI still shows the *first* event's reference — a person quoting it sends the operator to the wrong issue. Key the capture on the error (for example on `error.digest` plus message) or capture in a guarded effect that tracks the last reported error.

### 🟡 Provider response parsed with a bare cast, `src/analytics/sink.ts:140-143`

`(await lookup.json()) as { results?: … }` is an unchecked cast on data crossing back from a third party — the one shape of input the project's Zod rule exists for. A three-line schema removes the risk that a changed PostHog response shape becomes a confusing runtime error inside the erasure sweep. (The spec's own follow-up already flags this endpoint as unverified.)

### 🟡 One `after()` callback and one `flush()` per event, `src/analytics/client.ts:88-109`

`attempt` calls `scheduleFlush` after every `track`, `identify` and `groupIdentify`, so a request that fires an event plus two identifies schedules three post-response flushes against a client configured with `flushAt: 1`. Coalescing to one scheduled flush per request would cut provider round trips without changing behaviour.

### 🟡 Webhook responses now wait on analytics reads, `src/payments/webhook.ts:376-379`, `src/auth/webhook.ts:474`

`reportSubscriptionMirror` and `reportMembershipChange` are awaited before the handler answers, and each does two or three database reads plus provider queueing. Stripe and Clerk both have response-time budgets and retry on slow replies; this work has no reason to be inside them. Schedule it with `afterResponse` as the rest of the feature does.

### 🟡 The `when` slot is not in the spec's contract, `src/db/tenant/action.ts:105-110`

AC-10 defines `track` as `{ event, properties? }`. The implementation adds a third field, `when`, which two actions rely on (`confirmUpload`, `setDeliverableVisibility`). The slot is a good idea and well documented in code, but the spec is the contract for the next reader; record it there.

## Nits

- ⚪ `src/analytics/ui/cookie-banner.tsx:35`, the banner asks for consent on every non-portal page even when no PostHog key exists (local dev, the Playwright servers), so people are asked about a cookie that can never be set. Spec-conformant, but gating on `browserAnalyticsEnabled` would be kinder.
- ⚪ `src/db/tenant/action.ts:212`, `as Parameters<ReturnType<typeof analytics>["track"]>[1]` is an unchecked cast in a codebase that forbids them; a small generic helper would keep the guarantee.
- ⚪ `src/analytics/sink.ts:111-116`, `apiHostFor` only rewrites `<region>.i.posthog.com`; a self-hosted or custom host silently keeps the ingest host for `/api/` calls, which will read as "erasure mysteriously 404s".
- ⚪ `src/observability/configured.ts:28-38`, `unconfiguredReported` is set before the missing-key check, so a process that is fully configured still burns the one-shot; harmless today, surprising if the check later becomes dynamic.
- ⚪ `src/auth/webhook.ts:436-470`, the membership-removal branch reports `kind: "removed"` even when `deleteMembershipRows` removed nothing, causing a pointless `groupIdentify` read.

## Strengths

- `src/analytics/properties.ts`'s `defineProperties` constraint makes "a property may not be a plain string" a compile error rather than a review rule — the single best idea in the change, and it is used consistently across the whole catalogue.
- `subscriptionTransition` is extracted pure, unit-tested for every case, and computed under the existing row lock, so a webhook retry and the nightly reconcile genuinely cannot double-count a conversion.
- `action-track.test.ts` proves all four no-fire cases *and* the "a failing sink still returns `ok`" case against a recording sink — exactly the tests AC-10 and AC-21 asked for.
- The portal is held to its promise carefully: `next/dynamic` keeps the `posthog-js` chunk off portal pages entirely, portal events are client-scoped with `$process_person_profile: false`, and a test asserts no person or contact id is serialised.
- `verify.md` is unusually honest about what was and was not exercised on the live deploy, which is worth more than a page of ticks.

## Test coverage

Strong and mostly well aimed: 3580 unit tests pass, with new suites for the catalogue's privacy rule, the `enabled` predicate's five cases, the scrubber, the track slot, the transition, the erasure sweep, the consent reader and the browser provider, plus a 16-case Playwright consent walk that asserts no provider request leaves on four routes. Untested new logic worth closing: `useReportedError` / `reportBoundaryError` and the hand-written capture in `global-error.tsx` (AC-7's reporting half is only covered for the *rendering* of the reference); the stateful half of `src/analytics/browser.ts` (the pending queue, `capturePageview`, `identifyBrowser`, `applyConsent`) is exercised only indirectly through `provider.test.tsx`; and no test pins the blocker above — `sentry-scrub.test.ts` should gain a case for a URL carrying a token, and `provider.test.tsx` a case asserting the full captured property bag.

A full `pnpm test` run showed four failures across `src/auth/reconcile.db.test.ts`, `src/invoices/invoices.db.test.ts`, `src/deliverables/abandoned-sweep.db.test.ts` and `src/auth/webhook.db.test.ts`, all `afterEach` hook timeouts against the shared Supabase dev project; each file passes when run alone, so this reads as pooler contention rather than a regression from this branch — but it is worth watching, since this change adds database reads to the reconcile and webhook paths those suites drive.
