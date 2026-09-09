# Verify: agency sign in & organization · spec 0005 · updated 2026-09-10

_Steps derived from spec 0005 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Most of this list needs a signed in person, because Clerk puts bot protection in
front of sign up and an automated browser must not be used to get past it. The
build's own checks got as far as the two front door pages rendering, the theme
following the cookie in both directions, and the proxy redirecting; everything
below the first heading is what nobody has walked yet.

## Before you start

- [x] In the Clerk dashboard, turn **Organizations** on. Nothing that creates an
      agency can work until you do, and it is the one part of spec task 1 the
      build could not confirm → AC-2
- [x] While you are there: confirm **email with password** and **Google** are
      enabled as sign in methods (both rendered during the build, so this is a
      re-check, not a change), and set the application name. It currently reads
      "My Application" on the sign in card → AC-2 · both methods render, and the
      card now reads "Sign in to ClientHQ", not "My Application"
- [x] Copy the four `NEXT_PUBLIC_CLERK_*` values from `.env.example` into your
      `.env.local` (or `.env`). A missing one now fails with this project's own
      message rather than a broken redirect → AC-19

## UI / manual

### The front door

- [x] Open `/` signed out → press **Sign in** → `/sign-in` renders Clerk's card
      inside the ClientHQ frame, brand top left, theme control top right → AC-1
- [x] Press **Create an agency** on `/` → `/sign-up` renders the same way → AC-1
- [x] Switch the theme control to Light, then Dark, on `/sign-in`. Clerk's card
      follows both ways, and a reload paints the right palette in the first
      frame with no flash of the other one → AC-3
- [ ] With the system set to dark and no theme cookie, `/sign-in` is dark; an
      explicit Light choice still wins → AC-3
- [x] Tab through `/sign-in`: every stop shows the one product focus ring, and
      the email field and the Google button have a visible boundary against the
      card in both themes → AC-3, AC-18

### Signing up and creating an agency

- [x] Sign up with an email nobody has used → after verification you land on
      `/onboarding`, not on `/dashboard` and not on a Clerk hosted page → AC-1,
      AC-2
- [ ] `/onboarding` offers one field, the agency name. Submit it empty → the
      message appears beside the field, not only in a toast, and a screen reader
      announces it → AC-8, AC-18
- [ ] Submit 101 characters → refused with the same treatment → AC-8
- [x] Submit a real name → you land on `/dashboard`, and the welcome panel names
      that agency → AC-9, AC-15
- [x] In the database, `organizations`, `users` and `memberships` each have
      exactly one new row; the membership role is `admin`; the user's email is
      lowercase → AC-9, AC-13
- [x] The organization's `slug` is the kebab form of what you typed (confirmed:
      "Demo Account" → `demo-account`). Create a second agency with the *same*
      name from another account: its slug is suffixed rather than the write
      failing → AC-10 · the suffix behaviour itself is proven by
      `provisioning.db.test.ts`, not repeated here with a second live account
- [ ] Double click **Create agency**, or submit and immediately retry: exactly
      one Clerk organization exists afterwards, and the second attempt activates
      rather than creating another → AC-9 · not walked live this session
      (needs the one real Clerk account); the normal-membership case of this
      guard is unit tested (`src/auth/agency.test.ts`, "activates the existing
      agency instead of creating a second one"). The fresh model
      `/check review` on 2026-09-10 found this same guard let a person with
      only a soft-deleted membership through uncaught, dead-ending them on the
      create form forever (no error, typed name lost each round). Fixed
      2026-09-10 in `src/auth/agency.ts`: `createAgency()` now filters
      `deletedOrganizationClerkIds()` out of the Clerk membership list the
      same way `/onboarding` does, before deciding "existing" vs "create".
      Three new cases in `src/auth/agency.test.ts` cover it (only membership
      soft deleted → creates new; one of several soft deleted → picks the
      surviving one; all soft deleted → creates new), run clean this session
      (`corepack pnpm vitest run src/auth/agency.test.ts` → 13/13 passed) →
      AC-9, AC-14

### The repair path

- [x] Delete the `memberships`, `users` and `organizations` rows for your agency,
      leaving the Clerk organization alone. Reload `/dashboard`: it renders, the
      three rows are back, and you saw no redirect → AC-12
- [x] Do it again and reload two browser tabs at the same moment: still exactly
      one row in each table → AC-13
- [x] Set `deleted_at` on your `organizations` row and reload `/dashboard` → you
      land on `/onboarding` rather than on an error page, and the row is still
      there → AC-14 · **Resolved, re-checked 2026-09-10.** Fixed in `ed0088f`:
      `deletedOrganizationClerkIds()` now filters Clerk's membership list
      against the local mirror before `/onboarding` decides its branch, so a
      soft deleted org falls through to create/join instead of auto
      reactivating and bouncing back to `/dashboard`. Not re-walked live in a
      browser this session (would need the one real Clerk account, and
      nothing in this diff touches the Clerk-facing side of that path); the
      evidence is `src/app/(auth)/onboarding/page.test.tsx` (the regression
      case added in `ed0088f`) and `src/db/tenant/organization.db.test.ts`
      (`deletedOrganizationClerkIds()` against real PostgreSQL), both run
      clean this session (`corepack pnpm vitest run "src/app/(auth)/onboarding/page.test.tsx" src/db/tenant/organization.db.test.ts`
      → 2 files, tests passed).
- [ ] Delete the organization in the Clerk dashboard while signed in, then
      reload `/dashboard` → `/onboarding`, not an error page → AC-21 · not run,
      would delete the one real Clerk organization this session has
- [ ] Point `CLERK_SECRET_KEY` at a wrong value and reload `/dashboard` → an
      error, **not** a redirect to `/onboarding`. A Clerk outage must never read
      as "your agency is gone" → AC-21 · not run, would need editing `.env` and
      restarting the shared dev server

### The other branches

- [x] With exactly one agency, sign out and back in → you land on `/dashboard`
      without being asked which agency → AC-6
- [ ] Join a second agency, then open `/onboarding` → a picker lists both with
      your role in each; choosing one lands on `/dashboard` for that one → AC-6
      · not run, feature 16 (team members) has no invite flow yet to create a
      second membership
- [x] As a person who is both agency staff and an accepted client contact →
      `/onboarding` treats you as staff and never offers the portal → AC-6
- [ ] As an accepted `client_contacts` row with no membership → `/onboarding`
      redirects to `/portal`, and reloading `/portal` stays there rather than
      bouncing back → AC-7, AC-20 · the live walk needs a person with zero
      Clerk memberships, which this session only has by removing the one real
      account from its only organization, so not run; the branch itself
      (`isClientContact()`) is unit tested directly for both outcomes in
      `src/auth/context.test.ts:209`
- [x] Signed in with an active organization, open `/sign-in` and `/sign-up` →
      both redirect to `/dashboard` → AC-16
- [x] Sign out from the user menu → you land on `/` → AC-16

### The fence

- [x] Signed out, request `/dashboard`, `/clients`, `/design` and a path nobody
      has built (`/nothing-here`) → each redirects to `/sign-in` → AC-4
- [x] Signed out, request `/`, `/sign-in`, `/sign-up` → each renders → AC-4
- [ ] Signed in with **no** active organization, request `/dashboard` → you are
      redirected to `/onboarding` before the page renders → AC-5
- [ ] Signed in with no active organization, request `/onboarding` and `/portal`
      → both render rather than redirecting → AC-20

### Value sourcing (one per row of the spec's table)

- [ ] The dashboard name comes from **this database**, not Clerk: rename the
      organization in the Clerk dashboard without triggering a webhook. The
      dashboard still shows the old name until the mirror is repaired → AC-15
      · not run this direction; the reverse (below) is
- [x] Rename the local `organizations.name` directly → the dashboard shows the
      new name on the next load → AC-15
- [x] `/onboarding`'s branch comes from **Clerk**, not the local table: delete
      the local `memberships` row and open `/onboarding` → it still activates
      your agency rather than offering to create a second one → AC-6 · also
      surfaced that `resolveStaffContext()` never reads `memberships` at all
      (role comes from the session claim per `src/db/AGENTS.md`), so deleting
      that row triggers no repair and leaves the display mirror silently out of
      sync until the next full repair; not a spec violation today since nothing
      reads it for a decision yet, but worth knowing before feature 16 renders
      a member list from it
- [ ] The slug never comes from Clerk: change the Clerk organization's slug, then
      force a repair → the local `slug` is unchanged → AC-10 · not changed in
      Clerk this session, but the slug stayed `demo-account` unchanged across
      three separate repairs, and `upsertMirror()` in
      `src/db/tenant/provisioning.ts` excludes `slug` from its update set by
      construction
- [ ] The role comes from the session claim: make yourself a member rather than
      an admin in Clerk, sign in again, force a repair → `memberships.role` is
      `member`, and the dashboard says Member → AC-12 · not run, would demote
      the one real account this session has in its only organization
- [ ] Two agencies, two browsers, side by side: each dashboard names its own
      agency and never the other → AC-15 · not run, needs a second account

## Commands

- [x] `corepack pnpm typecheck` → clean
- [x] `corepack pnpm lint` → clean, which is also the proof that no new file
      imports `src/db/client.ts` and that `withSystemAccess` gained no caller →
      AC-17
- [x] `corepack pnpm vitest run src/proxy.test.ts` → both matchers match the
      spec exactly, including `/onboarding` and `/portal` sitting outside the
      organization check → AC-4, AC-5, AC-20
- [x] `corepack pnpm vitest run tools/eslint/tenant-isolation-config.test.mts` →
      neither ESLint exemption list has grown → AC-17
- [x] `corepack pnpm vitest run src/auth/slug.test.ts` → AC-10
- [x] `corepack pnpm vitest run src/auth/context.test.ts` → the repair routes a
      Clerk 404 to `/onboarding` and lets every other Clerk failure through →
      AC-12, AC-21
- [x] `corepack pnpm vitest run src/db/tenant/provisioning.db.test.ts` (needs
      `DIRECT_URL`) → the rows land, the repair is idempotent, a slug collision
      is suffixed, a soft deleted organization resolves as absent → AC-10,
      AC-12, AC-13, AC-14
- [x] `corepack pnpm test:e2e` → axe over `/sign-in`, `/sign-up`, `/onboarding`
      and `/portal` in both themes, one `h1` each, and Clerk's own sub paths
      resolving → AC-1, AC-3, AC-18
- [x] `corepack pnpm build` → clean

## Acceptance-criteria coverage

- AC-1 covered by the front door steps and the e2e sub path check
- AC-2 covered by the Clerk dashboard steps and the sign up walk
- AC-3 covered by the theme and focus steps, plus the axe run
- AC-4, AC-5, AC-20 covered by the fence steps and `src/proxy.test.ts`
- AC-6, AC-7 covered by the other branches steps
- AC-8, AC-9 covered by the create an agency steps
- AC-10 covered by the slug steps, `slug.test.ts` and `provisioning.db.test.ts`
- AC-11 covered by the retry message step under the repair path
- AC-12, AC-21 covered by the repair path steps and `context.test.ts`
- AC-13, AC-14 covered by the repair path steps and `provisioning.db.test.ts`
- AC-15 covered by the value sourcing steps
- AC-16 covered by the signed in redirect and the sign out step
- AC-17 covered by `pnpm lint` and the exemption list test
- AC-18 covered by the validation message steps and the axe run
- AC-19 covered by the `.env.local` step

## Found by /check verify (2026-09-09)

- **AC-14 fails as specced: soft deleting an organization's local mirror row
  produces an infinite redirect loop between `/onboarding` and `/dashboard`
  instead of a stable landing on `/onboarding`.** See the repair path section
  above for the root cause and the exact files. Route to `/debug`. Confirmed
  live, reproduced twice, resolved immediately by clearing `deleted_at`, so
  nothing was left broken. **Fixed in `ed0088f`, re-checked 2026-09-10 (see
  below).**
- Deleting only the local `memberships` row (org and user rows intact) is
  invisible to staff resolution and never gets repaired, because
  `resolveStaffContext()` does not read that table at all. Not a spec
  violation today; flagged for when feature 16 renders a member list from it.

## Found by /check verify (2026-09-10)

- **`ed0088f`'s AC-14 fix only closed the `/onboarding` ↔ `/dashboard` loop
  on the read side; the fresh model `/check review` the same day found the
  other half: `createAgency()`'s double-submit guard did the same Clerk
  membership read with no soft-deleted filter, so a person whose only
  membership is soft deleted locally could still get dead-ended, this time
  from the create form (no error shown, typed name lost each round). Now
  fixed** in `src/auth/agency.ts` (uncommitted at time of this check):
  `createAgency()` filters `deletedOrganizationClerkIds()` before picking
  `existing`, exactly mirroring the `/onboarding` fix. Confirmed by:
  - `corepack pnpm typecheck` → clean
  - `corepack pnpm lint` → clean
  - `corepack pnpm vitest run src/auth/agency.test.ts` → 13/13 passed
    (3 new cases for the soft-deleted-membership branches)
  - `corepack pnpm test` (full suite) → 63 files / 1483 tests passed,
    including the real-PostgreSQL integration suites
    (`organization.db.test.ts`, `provisioning.db.test.ts`)
  - `corepack pnpm build` → clean
  - Live smoke check: signed out, `/dashboard` still redirects to `/sign-in`
    rendering Clerk's card inside the ClientHQ frame ("Sign in to ClientHQ",
    not "My Application"), theme toggle and Google/email options present —
    no regression to the fence or front door from this change.
  - Not walked live end to end in a browser (would need the one real Clerk
    account and setting `deleted_at` mid-session); the underlying logic is
    unit tested directly per the note under "Double click **Create agency**"
    above. This is the same evidence standard this file already applies to
    AC-10's slug-suffix case, which also relies on `provisioning.db.test.ts`
    rather than a live second account.
  - Four Minor findings and a handful of Nits from the same review (a
    swallowed activation failure on `CreateAgencyForm`, a Playwright `env`
    override that makes one e2e assertion unreachable, a discarded slug
    computation on the repair's hot path, and the agency picker losing the
    list on a failed pick) are **not** addressed by this diff and remain
    open — see `docs/reviews/2026-09-10-feat-agency-sign-in-and-organization.md`.

## Still open from the build

- The manual keyboard and screen reader pass on `/sign-in`, `/sign-up`,
  `/onboarding` and `/portal` (spec task 22). The axe run landed; the human pass
  did not.
- Genuine cross connection concurrency on the repair. The database suite proves
  the upsert is re-entrant on one connection; two real browser tabs is the check
  above, confirmed this session: exactly one row landed in each table.
- Still not run: the double submit retry on agency creation, the empty/101
  character form validation, the Clerk side of the repair (deleting the org in
  Clerk, a wrong `CLERK_SECRET_KEY`, demoting the role in Clerk, renaming in
  Clerk), the second agency picker, and the contact only `/portal` walk. All
  of them need either a second account or an action against the one real
  Clerk organization this session has that would have been awkward to undo.
