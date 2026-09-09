# Review, feat/agency-sign-in-and-organization, 2026-09-10

**Reviewed by**: Claude Opus 5 (author on Claude Opus 5 — this reviewer did not write the code)
**Scope**: 58 files, branch vs `main` (merge base `bdddd73`)
**Verdict**: Changes requested

## Summary

This is the feature that closes spec 0004's known hazard, and it closes it properly: `src/proxy.ts` now fails closed with a five-entry public list, the organization check is scoped to the seven agency paths only, and both matchers are pinned by a test that asserts the literal arrays against the acceptance criteria. The tenant-isolation story is intact — no new file imports `src/db/client.ts`, neither ESLint exemption list grew, provisioning is two named functions inside `src/db/tenant/`, tenant context still comes only from the Clerk session, and the `deleted_at is null` amendment lands in both the resolver and the new `agencyProfile()` reader. Typecheck, ESLint, Prettier and the 1436-test unit suite are all green.

The one real problem is a gap in the fix that shipped in `ed0088f`: the `/onboarding` ↔ `/dashboard` loop on a locally soft-deleted organization was closed on the `/onboarding` branch but not in `createAgency`'s double-submit guard, so the same person can still be dead-ended — this time from the create form. Everything else is minor: a client-side activation failure that is silently swallowed on the create path, and a Playwright `env` override that has quietly made one existing e2e assertion unreachable.

## Major

### 🟠 The soft-deleted-organization loop is only half fixed: `createAgency`'s guard doesn't filter deleted mirrors, `src/auth/agency.ts:102`

**Problem**: Commit `ed0088f` fixed the `/onboarding` ↔ `/dashboard` loop by filtering Clerk memberships whose local `organizations` row is soft deleted (`deletedOrganizationClerkIds()` in `src/app/(auth)/onboarding/page.tsx:61-66`). `createAgency`'s double-submit guard does the same Clerk read and applies no such filter:

```ts
const [existing] = await agencyMemberships(clerkUserId);
if (existing !== undefined) {
  return { kind: "existing" as const, clerkOrgId: existing.clerkOrgId };
}
```

So for a person whose only Clerk membership has a soft-deleted local mirror, the loop reopens through the create form: `/onboarding` filters the org out and shows `CreateAgencyForm` → they type a name and submit → `agencyMemberships()` returns the soft-deleted org → the action returns `ok({ clerkOrgId: <deleted org>, alreadyExisted: true })` without ever calling Clerk or writing a row → the form activates it and navigates to `/dashboard` → `agencyContext()` raises `no_mirror_row`, `repairMirror()` upserts but deliberately never clears `deleted_at` → `resolveStaffContext()` refuses again → `redirect("/onboarding")` → the create form again. Forever, with no error shown and the typed name lost each round.

**Why it matters**: The person is permanently unable to use the product and there is nothing on screen telling them why — the button appears to do nothing. It is exactly the failure mode the `/onboarding` fix was written to eliminate, reached by the one path that fix did not cover. Reachability is currently latent (nothing in the repo writes `organizations.deleted_at` yet — feature 17's Clerk webhook will), but the just-shipped fix, the `AC-14` criterion and `deletedOrganizationClerkIds()`'s own docblock all treat this state as reachable; if it is reachable on one branch it is reachable on the other.

**Suggested fix**: Apply the same filter inside the guard — drop any Clerk membership whose `clerkOrgId` is in `deletedOrganizationClerkIds()` before deciding "existing", so a person with only soft-deleted memberships falls through to the real create path and mints a new agency. Add a unit test for it alongside the existing "activates the existing agency instead of creating a second one on a retry" case in `src/auth/agency.test.ts:106`, mirroring the regression test already in `src/app/(auth)/onboarding/page.test.tsx:128`.

## Minor

### 🟡 `CreateAgencyForm` navigates whether or not activation actually happened, `src/auth/ui/create-agency-form.tsx:54-55`

**Problem**: `useActivateAgency().activate()` swallows both of its non-success outcomes — it returns immediately when `setActive` is still `undefined` (Clerk not loaded), and it catches a rejected `setActive` into `state === "failed"` without rethrowing (`src/auth/ui/use-activate-agency.ts:27-38`). `ActivateAgency` and `AgencyPicker` both read that `state` and render `ActivationFailed`; `CreateAgencyForm` ignores it and unconditionally calls `router.replace("/dashboard")` on the next line. That `replace` is also redundant on the success path — `activate()` has already navigated.

**Why it matters**: A failed or skipped `setActive` after a successful agency creation sends the person to `/dashboard` with no organization claim, the proxy bounces them to `/onboarding`, and they land on the auto-activate screen rather than on the honest "That did not open / Try again" panel the other two callers show. It self-heals, but the person sees an unexplained round trip on the single most important moment in the flow, and the two activation call sites now behave differently for no stated reason.

**Suggested fix**: Have the form read `state` from the hook the way `ActivateAgency` does and render `ActivationFailed` when it is `"failed"`, and drop the second `router.replace("/dashboard")` since `activate()` owns the navigation.

### 🟡 Blanking the Clerk keys for Playwright makes `env()` throw, so the health route's 200 branch is now unreachable, `playwright.config.ts:78`

**Problem**: The new `webServer.env` sets `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ""` and `CLERK_SECRET_KEY: ""`. `clerkPublishableKey()` treats `""` as absent, which is the intended effect on the proxy — but `src/lib/env.ts` declares both as `z.string().min(1)`, so `env()` now fails validation for the whole process. `src/db/client.ts:32` calls `env()` at module scope, so `/api/health/db` catches that throw and returns 503 on every run, even for a developer whose `.env` has a working Supabase URL.

**Why it matters**: Three assertions in `e2e/scaffold.spec.ts` (lines ~105-160) are written to accept either branch — "with credentials present it is 200, without them 503". That second branch is now the only one that can execute, so the checks that `roundTripMs` is a number and that a live connection actually answers are dead in every environment. It also means the e2e suite no longer exercises `env()` in its real, fully-populated shape.

**Suggested fix**: Blank only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (that is the variable `isClerkConfigured()` reads, and it is what makes the proxy a pass-through), leaving `CLERK_SECRET_KEY` alone — or make both optional in the Zod schema, since `isClerkConfigured()` already encodes "these may legitimately be absent". Either way, note in the config comment which of the two the pass-through actually depends on.

### 🟡 The repair path derives a slug it then throws away, inside the transaction, `src/db/tenant/provisioning.ts:100`

**Problem**: `upsertMirror()` calls `freeSlug()` unconditionally before the organizations upsert, but the slug is deliberately absent from the `onConflictDoUpdate` set, so on the common repair path (org row exists, user row missing) the value is computed and discarded. `freeSlug()` is a `select` with `or(eq(slug, base), like(slug, base || '-%'))`; the `LIKE` half will not use the unique index under the database's default collation, so this is a sequential scan of `organizations` on every mirror repair, held open inside the transaction.

**Why it matters**: Spec 0005's own Consequences already flag the repair as "a real cost on the worst request". This adds a table scan to it that produces nothing on the branch that runs most often. It is invisible at ten agencies and gets slower in exactly the way that is hard to attribute later.

**Suggested fix**: Look the organization row up by `clerk_org_id` first and only derive a slug when there is no row (or pass the slug in from the two callers, which already know whether they are creating or repairing). If the scan is kept, consider a `text_pattern_ops` index on `organizations.slug` so the prefix match is indexable.

### 🟡 A failed pick replaces the whole picker, so a person can no longer choose a different agency, `src/auth/ui/agency-picker.tsx:39-50`

**Problem**: When `state === "failed"` the component returns `ActivationFailed` in place of the list, and its `onRetry` re-chooses the same agency. Separately, while `ready` is false every button is `disabled` with nothing announcing why.

**Why it matters**: For someone who serves several agencies, picking the wrong one and being unable to get back to the list is a dead end that costs a page reload. And a screen of unexplained disabled buttons is a WCAG 2.2 AA concern on a surface the spec explicitly asks to meet AA in its loading state (AC-18) — disabled controls are not focusable, so there is nothing for assistive technology to land on and no `role="status"` narrating the wait.

**Suggested fix**: Render `ActivationFailed` above the list rather than instead of it, so the other agencies stay selectable. Add a `role="status"` line ("Loading your agencies…") for the not-ready state, matching what `ActivateAgency` already does.

### 🟡 Two new behaviours have no test

**Problem**: The soft-delete gap in the Major above has no coverage (`src/auth/agency.test.ts` has no soft-deleted-membership case), and `CreateAgencyForm`'s behaviour when activation fails is untested — `src/auth/ui/create-agency-form.test.tsx:26-30` hardcodes `state: "idle"` in the hook mock, so the branch that would surface a failure is never rendered.

**Why it matters**: Both are error-path branches on the flow that gates every other feature, and the project's own convention weighs branching/error-path logic as needing coverage. The existing suite is otherwise unusually thorough about exactly these cases, which makes the two gaps stand out.

**Suggested fix**: One `agency.test.ts` case asserting that a soft-deleted-only membership falls through to creation, and one `create-agency-form.test.tsx` case with the hook mock in `state: "failed"`.

## Nits

- ⚪ `src/app/(agency)/dashboard/page.tsx:22`, `const [ctx, agency] = [await agencyContext(), await currentAgency()]` reads like `Promise.all` but is two sequential awaits; two plain `const`s say the same thing without the misdirection (the second call is cache-cheap, so nothing is actually lost).
- ⚪ `src/proxy.ts:30-31`, `/sign-in(.*)` and `/sign-up(.*)` also match sibling paths like `/sign-in-help` or `/sign-upgrade`, so a future route with either prefix would be silently public. The spec pins these exact strings and the test pins them to the spec, so this is a note for whoever adds such a route, not a change to make now.
- ⚪ `src/auth/agency.ts:71`, `alreadyExisted` is returned, documented and asserted in tests, but no caller reads it — `CreateAgencyForm` takes the same path either way.
- ⚪ `docs/specs/0005-agency-sign-in-and-organization/index.md:230` ("Agency creation is unlimited and unrated. One signed in account can create arbitrarily many agencies") and the matching Follow-up item are no longer accurate: AC-9's membership guard means a second agency cannot be created through this action at all. Worth reconciling so the rate-limit follow-up is not chased for a risk that does not exist.
- ⚪ `src/auth/ui/activation-failed.tsx:3-4`, `Button` is imported before `Alert`, unlike every other file in the folder.

## Strengths

- `src/proxy.test.ts` is the right test for the right line: it asserts the literal `PUBLIC_ROUTES` / `AGENCY_ROUTES` arrays against the acceptance criteria, then runs the real `createRouteMatcher` over Clerk's own sub-paths, over `/onboarding` and `/portal` specifically, and over a route nobody has written — the fails-closed property is checked as a property, not as a list of examples.
- The AC-21 split (a Clerk 404 is `not_found` and routes; anything else propagates) is implemented structurally in `src/auth/clerk.ts:37` with a stated reason for avoiding `instanceof ClerkAPIResponseError`, and both halves are tested for both records in `src/auth/context.test.ts:154-184`. Getting this backwards is the kind of thing that quietly logs people out during a provider blip, and it was clearly thought about.
- `agencyContext()` wrapping the repair *inside* the `cache()` boundary, with the docblock explaining that React memoises rejections and why the retry has to use the uncached `resolveStaffContext()`, is a genuinely subtle correctness point handled correctly.
- The load-bearing rule holds without ceremony: `createAgencyRows`/`ensureMirrorRows` are named doors inside `src/db/tenant/`, `withSystemAccess` gained no caller, both ESLint exemption lists are byte-identical, and `deletedOrganizationClerkIds()` — the one new unscoped read outside the accessor — can only return ids the caller already supplied from its own Clerk session.
- `provisioning.db.test.ts` proves the hard parts against real PostgreSQL rather than against mocks: idempotent repair, two overlapping repairs, the slug not being rewritten on conflict, and the soft-deleted organization resolving as absent.

## Test coverage

Strong, and unusually well-targeted. 59 unit files / 1436 tests pass; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` are all clean. Coverage tracks the acceptance criteria closely: the proxy matchers (AC-4/5/20), the slug helper's termination property (AC-10), the Clerk boundary's 404-vs-everything-else split (AC-21), the repair's routing (AC-12/14), the onboarding branch order including the soft-delete regression (AC-6/7/14), the create action's sequencing and error mapping (AC-8/9/11), and real-PostgreSQL integration tests for provisioning and the organization reader (AC-10/12/13/14/15). The e2e suite adds axe over `/sign-in`, `/sign-up`, `/onboarding` and `/portal` in both themes.

Two gaps, both listed above as Minor: the soft-deleted-membership path through `createAgency`, and `CreateAgencyForm`'s activation-failure branch. One caveat rather than a gap: the e2e suite runs with no Clerk credentials by design, so the browser layer exercises the "not configured" panels rather than Clerk's real markup — the spec is explicit about that and `verify.md` carries the manual walk, but it does mean AC-2, AC-3 inside Clerk's own card, and the double-submit behaviour are confirmed by a person, not by CI.
