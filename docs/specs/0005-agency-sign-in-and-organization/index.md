# 0005. Agency sign in and organization

**Date**: 2026-09-09
**Status**: In Progress

## Summary

This settles how a person gets into ClientHQ and how their agency comes into existence. Clerk's own sign in and sign up components are mounted on the project's own `/sign-in` and `/sign-up` routes and themed to the design tokens, so the front door looks like the rest of the product. `src/proxy.ts` stops being wide open and starts requiring a session on everything except a short public list, which closes the hazard spec 0004 knowingly left in `main`. A person with no agency lands on `/onboarding`, which activates their only agency, lets them pick between several, sends a client contact to the portal, or takes one field and creates the agency. Creating an agency writes the local `organizations`, `users` and `memberships` rows (the mirror of what Clerk knows), and if those rows are ever missing they are repaired on the next request from Clerk's API, which is the safety net spec 0001 promised and spec 0003 handed here.

## Requirements

**User stories**:
- As an agency owner, I want to sign up and create my agency in one short flow, so that I can start using the product without configuring anything.
- As returning agency staff, I want to sign in and land straight on my agency's dashboard, so that I do not pick my agency again on every session.
- As someone who serves two agencies, I want to choose which one I am acting as, so that I never write into the wrong one.
- As an invited client contact, I want signing in to take me to my portal, so that I am never asked to create an agency I do not want.
- As the person operating this product, I want no agency route readable without a session, so that feature 7's real client rows are not public the day they ship.

**Acceptance criteria**:
- **AC-1**: `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]` render Clerk's `<SignIn />` and `<SignUp />` inside the project's own page frame, at the exact paths spec 0004 pinned, so both buttons on `/` resolve.
- **AC-2**: The Clerk application offers email with password and Google. Both complete a sign up end to end on the deployed app.
- **AC-3**: Both Clerk components are themed to spec 0004's tokens in light and dark, follow the theme cookie, and show no flash of the wrong theme on load.
- **AC-4**: `src/proxy.ts` requires a session on every route except an explicit public list: `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/webhooks/(.*)` and `/api/cron/(.*)`, plus Next's own assets. The two wildcards are required, not cosmetic: Clerk drives its verification, factor and SSO callback steps on sub paths of those routes. A route that does not exist yet is protected by default, and an unauthenticated request to any other path is redirected to `/sign-in`.
- **AC-5**: The proxy's no active organization check applies **only to the agency paths** (`/dashboard`, `/clients`, `/projects`, `/invoices`, `/team`, `/billing`, `/settings`). A signed in request to one of those carrying no active Clerk organization is redirected to `/onboarding` before the page begins rendering. See AC-20 for what is deliberately outside that check.
- **AC-6**: `/onboarding` branches on the membership count Clerk reports: exactly one activates it and continues to `/dashboard`, several render a picker, none renders the create agency form. A person who is both agency staff and an accepted client contact is treated as staff: a membership always wins over a contact row. Activation awaits Clerk's `setActive` and navigates only after it resolves, so the redirect never outruns the session cookie write.
- **AC-7**: A signed in person with no agency membership but an accepted `client_contacts` row is redirected from `/onboarding` to `/portal`, never shown the create agency form.
- **AC-8**: The create agency form takes one field, the agency name, parsed by Zod at the action boundary (1 to 100 characters after trimming).
- **AC-9**: Submitting it creates the Clerk organization with the submitter as `org:admin`, then writes `organizations`, `users` and `memberships` in one transaction, then activates the new organization so the next request resolves it. Before creating, the action re reads the membership count from Clerk; if it is now nonzero, meaning the request was retried or double submitted, it activates that organization instead of minting a second one.
- **AC-10**: The slug is derived from the name (lowercased, runs of non alphanumeric characters collapsed to one `-`, trimmed) and suffixed until free against `organizations.slug`, by one helper that both agency creation and the repair call. The derived value is also offered to Clerk, but **the local column is never sourced from Clerk's stored slug**. After a collision race the two may differ, which is harmless because spec 0001 fixed that no slug ever appears in a URL, and sourcing it from Clerk would make the repair retry the identical unique violation forever.
- **AC-11**: If the local transaction fails after the Clerk organization exists, no partial local rows remain and the person sees a retry message rather than an error page. Their next agency request heals the mirror through AC-12.
- **AC-12**: When staff resolution raises `no_mirror_row`, the agency route group layout upserts the three rows and resolves again, with no redirect visible to the person. The organization and user columns come from the Clerk backend API; `memberships.role` comes from the session's own organization role claim through `toMembershipRole()`, so no third Clerk call is needed. On the normal path it performs no extra query and no extra write.
- **AC-13**: That repair is idempotent. Two concurrent requests for the same user both succeed and leave exactly one row in each table. Each write is `onConflictDoUpdate` on its unique key, because Clerk is authoritative for every mirrored column and feature 17's webhook will need the same behaviour.
- **AC-14**: Staff resolution treats an organization whose `deleted_at` is set as absent, raising `no_mirror_row` rather than returning a live tenant.
- **AC-15**: `/dashboard` shows a welcome panel naming the agency, read from the local `organizations` row through spec 0003's accessor rather than from a Clerk client hook.
- **AC-16**: A signed in person with an active organization who opens `/sign-in` or `/sign-up` is redirected to `/dashboard`. Signing out returns to `/`.
- **AC-17**: Provisioning writes reach the database only through named functions inside `src/db/tenant/`. No new file imports the raw handle, and neither ESLint exemption list grows.
- **AC-18**: Every new surface meets WCAG 2.2 AA including its loading, empty and error states, and the onboarding form reports validation errors to assistive technology.
- **AC-19**: Every new environment variable is declared in the Zod schema in `src/lib/env.ts`, so a missing one fails with the project's own message. The four `NEXT_PUBLIC_CLERK_*` URL variables are read by Clerk's SDK straight from `process.env`, so declaration is what this criterion asks of them rather than a read through `env()`, following the precedent already set in `src/db/tenant/session.ts` and `clerkPublishableKey()`.
- **AC-20**: `/onboarding` and `/portal` are exempt from the organization check and require a session only. A client contact, who by design never carries an organization claim, reaches `/portal` and stays there instead of being bounced back to `/onboarding` on every load.
- **AC-21**: The repair separates two Clerk failures. A 404 on the organization or the user is the expected case, meaning the organization was deleted or the person was removed, and redirects to `/onboarding`. Any other Clerk failure propagates as an error rather than being mistaken for a clean absent state.

## Decision

**Chosen option**: Option 2: Clerk components on your own routes, your own onboarding action, and a lazy mirror repair.

Mount Clerk's prebuilt sign in and sign up components on the project's own routes and theme them; narrow `src/proxy.ts` to protect everything outside a short public list and send a signed in person with no active organization to `/onboarding`; create the agency through a Server Action that calls Clerk first and then writes all three mirror rows in one transaction; and repair missing mirror rows lazily from the Clerk backend API when spec 0003's resolver says they are missing.

**Implementation skills**: `clerk` (`.agents/skills/clerk/`) · `clerk-orgs` (`.agents/skills/clerk-orgs/`) · `clerk-nextjs-patterns` (`.agents/skills/clerk-nextjs-patterns/`) · `clerk-custom-ui` (`.agents/skills/clerk-custom-ui/`) · `clerk-backend-api` (`.agents/skills/clerk-backend-api/`) · `clerk-testing` (`.agents/skills/clerk-testing/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `zod` (`.agents/skills/zod/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`)

## Rationale

Reasoning, the four options weighed, and the amendment this makes to spec 0003: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

No new tables and no new columns. This feature is the first thing that writes the three identity tables spec 0002 already shipped, so there is no migration.

| Table | Fields written here | Rules |
|---|---|---|
| `organizations` | `id`, `clerk_org_id` (unique), `name`, `slug` (unique) | Written by agency creation and by the repair. `next_invoice_number` and `default_currency` take their spec 0002 defaults. `deleted_at` is read only here: a set value means the row resolves as absent |
| `users` | `id`, `clerk_user_id` (unique), `email` (lowercase), `name` (nullable), `image_url` (nullable) | Not tenant scoped. Values come from the Clerk backend API, never from a form. Upserted on `clerk_user_id` |
| `memberships` | `id`, `org_id`, `user_id`, `role` | Unique on (`org_id`, `user_id`). A display mirror only: no permission check reads it. Written as `admin` for an agency's creator, otherwise mapped from the Clerk role |

The one schema adjacent change is a `deleted_at is null` predicate added to the staff resolution query in `src/db/tenant/context.ts`, which amends spec 0003 rather than the schema.

**State transitions** (the routing state machine this feature owns):

```
signed out                 → /sign-in or /sign-up          (proxy, AC-4)
signed in, on an agency path, no active org → /onboarding  (proxy, from the session claim, AC-5)
signed in, on /onboarding or /portal        → no org check  (AC-20)
  ├─ one membership        → activate it → /dashboard      (AC-6)
  ├─ several memberships   → picker → activate → /dashboard(AC-6)
  ├─ no membership, has an accepted contact row → /portal  (AC-7)
  └─ no membership, no contact row → create agency form
       └─ submit → Clerk org created → three rows written → activate → /dashboard  (AC-9)
signed in, active org, mirror rows present → the page renders
signed in, active org, mirror rows missing → repair from Clerk, resolve again, render (AC-12)
signed in, active org, org soft deleted locally → resolves as missing → repair → /onboarding (AC-14, AC-21)
signed in, active org, org or user 404s at Clerk → /onboarding, not an error page (AC-21)
signed in, active org, Clerk fails some other way → the error propagates (AC-21)
```

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/sign-in/[[...sign-in]]` | page, GET | none | Clerk `<SignIn />` in the project frame | public | signed in with an org redirects to `/dashboard` |
| `/sign-up/[[...sign-up]]` | page, GET | none | Clerk `<SignUp />` in the project frame | public | as above |
| `/onboarding` | page, GET | none | activate, picker, contact redirect, or the create form | session required, exempt from the org check (AC-20) | no session redirects to `/sign-in` |
| `createAgency` | Server Action | `name: string` (req) | `Result<{ clerkOrgId }>` | session required, exempt from the org check | `invalid_input` from Zod, `conflict` on a slug race (healed by the repair, AC-10), `unavailable` when Clerk fails |
| `activateAgency` | client call | the chosen `clerkOrgId` | navigation to `/dashboard` | session required | Clerk `setActive` failure surfaces as a retry |
| `ensureMirrorRows` | server function | the session's `clerkUserId`, `clerkOrgId`, `clerkOrgRole` | the repaired ids | called only from the agency layout | a Clerk 404 redirects to `/onboarding`; any other Clerk failure propagates (AC-21) |
| `/dashboard` | page, GET | none | the shell plus the welcome panel naming the agency | session and active org | `no_mirror_row` triggers the repair, then renders |
| `/portal` | page, GET | none | a placeholder owned by feature 15 | session required, exempt from the org check (AC-20) | no session redirects to `/sign-in` |
| `src/proxy.ts` | proxy | the session claims | pass through or redirect | not applicable | no session redirects to `/sign-in`; no org on an agency path redirects to `/onboarding` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `createAgency` | `organizations.clerk_org_id` | the Clerk `createOrganization` response |
| `createAgency` | `organizations.name` | the form input, after the Zod parse |
| `createAgency` | `organizations.slug` | the shared `uniqueSlug()` helper, run against `organizations.slug`. Never Clerk's stored slug |
| `createAgency` | `next_invoice_number`, `default_currency` | not set here; spec 0002's column defaults |
| `createAgency` | `users.clerk_user_id` | the Clerk session claim, through `sessionClaims()` |
| `createAgency` | `users.email`, `name`, `image_url` | the Clerk backend API user record; the email lowercased at the boundary to satisfy the CHECK |
| `createAgency` | `memberships.role` | the literal `admin`, because the creator is created as `org:admin` |
| `createAgency` | whether to create at all | a re read of Clerk's membership count, so a retried submit activates rather than creates (AC-9) |
| `createAgency` | `memberships.org_id`, `user_id` | the two rows written in the same transaction |
| `ensureMirrorRows` | `organizations.name`, `users.email`, `name`, `image_url` | the Clerk backend API organization and user records, keyed by the session's `orgId` and `userId` |
| `ensureMirrorRows` | `organizations.slug` | the shared `uniqueSlug()` helper, re run locally. Never copied from Clerk, or a slug race would repeat forever |
| `ensureMirrorRows` | `memberships.role` | the session's `clerkOrgRole` claim through `toMembershipRole()`, which spec 0003 already provides. No extra Clerk call |
| `/onboarding` branch | the membership count | Clerk's organization membership list for the session user, never the local `memberships` table |
| `/onboarding` branch | whether this person is a client contact | `contactContext()` from spec 0003, which reads `client_contacts` by `user_id` |
| `/dashboard` panel | the agency name shown | the local `organizations.name` row, read through `tenantDb(ctx)` |
| `/dashboard` panel | which agency is meant | `ctx.orgId` from `staffContext()`, which comes from the Clerk session |
| `src/proxy.ts` | whether an organization is active | the `orgId` session claim only, with no database read |
| sign in and sign up | where a completed flow lands | `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` and its sign up twin, both `/onboarding` |

**Key invariants**:

- Provisioning writes go through named functions in `src/db/tenant/provisioning.ts` that touch only `organizations`, `users` and `memberships`. No callback receives a raw `Database` handle, so no new escape hatch exists and neither ESLint exemption list grows.
- Clerk is created before the local rows, always. `organizations.clerk_org_id` is not null and unique, so there is no valid local row to write first.
- All three local rows are written in one transaction. A partial mirror is never committed.
- The mirror is never repaired from session claims alone. `users.email` is not null with a lowercase CHECK and `organizations.name` and `slug` are not null, so only the Clerk backend API can supply a valid row.
- Every provisioning write is `onConflictDoUpdate` on its unique key (`clerk_org_id`, `clerk_user_id`, and the `(org_id, user_id)` pair), so a concurrent repair updates rather than fails, and Clerk stays authoritative for every mirrored column.
- The local slug is always resolved by `uniqueSlug()` against `organizations.slug` and never copied from Clerk. Copying it would make the repair retry the exact unique violation that caused the failure it is repairing.
- The proxy's organization check covers the agency paths only. `/onboarding` and `/portal` need a session and nothing more, because a client contact never carries an organization claim.
- Permission decisions read the Clerk session claim. `memberships.role` is written here and never read for a decision.
- The proxy makes its redirect decisions from session claims only. It performs no database call, which keeps it inside spec 0001's pooler constraints.

**Security model**:

Read and write access in this feature is governed by two things: whether a session exists, and whether it names an active organization. The proxy fails closed, so an unlisted route requires a session even if nobody thought about it, which is the point: feature 7 and everything after it inherit protection by default rather than by memory. `/onboarding` is the one route deliberately reachable with a session and no organization, and it writes nothing until the form is submitted.

Agency creation is open to any signed in person by design (the engineer chose unlimited agencies per person), so it is authenticated but not role restricted. It is not rate limited in this feature; see Follow-up.

The personal data touched is a name, an email address and an avatar URL, all mirrored from Clerk rather than collected by this product. No new category of regulated data enters the system, so no new compliance scope is triggered. Deletion and scrubbing stay with `scrubUser()` from spec 0002 and feature 17's webhook.

The single most consequential line in this feature is the proxy matcher, because it is what stops the agency area being publicly readable. It carries its own test.

**Configuration required**:

- `NEXT_PUBLIC_CLERK_SIGN_IN_URL`: `/sign-in`, so Clerk's components and redirects agree with the pinned path
- `NEXT_PUBLIC_CLERK_SIGN_UP_URL`: `/sign-up`, same reason
- `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`: `/onboarding`, where a completed sign in lands when Clerk has no better target
- `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL`: `/onboarding`, the same for a completed sign up
- `E2E_CLERK_USER_USERNAME` and `E2E_CLERK_USER_PASSWORD`: optional, only the browser suite reads them; a dedicated user in the Clerk development instance, so `/test` has a documented way in

`CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` already exist in `src/lib/env.ts` and are unchanged.

Prerequisites in the Clerk dashboard, before any of this can be verified: turn the Organizations feature on, enable email with password and Google as sign in methods, and leave the personal account allowed (the product routes people itself rather than letting Clerk gate them).

**Critical test scenarios**:

- Happy path: a new person signs up with email and password, creates an agency named on one field, and lands on `/dashboard` showing that name read from the local `organizations` row, verifies **AC-1**, **AC-2**, **AC-8**, **AC-9**, **AC-10**, **AC-15**
- Failure case: the local transaction fails after the Clerk organization is created; no partial rows are committed, the person sees a retry message, and their next request repairs the mirror and renders normally, verifies **AC-11**, **AC-12**
- Failure case: the local write fails specifically on a slug collision; the repair resolves a fresh unique slug locally rather than reusing Clerk's, so the second attempt succeeds instead of repeating the violation, verifies **AC-10**, **AC-11**
- Failure case: Clerk returns 404 for the organization on the repair path and the person reaches `/onboarding`, while a transient Clerk error propagates instead, verifies **AC-21**
- Failure case: the create form is submitted twice; exactly one Clerk organization exists afterwards and the second submit activates rather than creates, verifies **AC-9**
- Failure case: two concurrent requests both hit `no_mirror_row` for the same user; both succeed and exactly one row exists in each table, verifies **AC-13**
- Failure case: an organization with `deleted_at` set resolves as absent rather than as a live tenant, verifies **AC-14**
- Auth/permission: an unauthenticated request to `/dashboard`, to a route that does not exist yet, and to `/onboarding` is redirected to `/sign-in`, while `/`, `/sign-in`, `/sign-up`, the webhook routes and the cron route pass through, verifies **AC-4**
- Auth/permission: a signed in person with no active organization is redirected to `/onboarding` before any agency page renders, verifies **AC-5**
- Auth/permission: a signed in person with an accepted `client_contacts` row and no membership reaches `/portal`, not the create agency form, and stays there on reload rather than bouncing back to `/onboarding`, verifies **AC-7**, **AC-20**
- Auth/permission: a person who is both agency staff and an accepted contact is treated as staff and lands on `/dashboard`, verifies **AC-6**
- Accessibility: the sign in, sign up and onboarding routes pass axe in both themes, and the onboarding form's validation error is announced, verifies **AC-3**, **AC-18**

## Build plan

Ordered as a Tracer Bullet, the project's approach: task 1 through 9 stand up one thin thread all the way through (Clerk configuration, a protected route, a real organization, three real rows, a dashboard reading its own table), and everything after thickens it. Nothing in tasks 10 onward is needed for the thread to be walkable end to end.

**Milestone 1: one thread end to end**

1. [ ] Configure the Clerk application: Organizations on, email with password and Google enabled, and record the settings in the spec's prerequisites so `/check verify` can confirm them, satisfies **AC-2**
2. [x] Declare the four `NEXT_PUBLIC_CLERK_*` URL variables in the Zod schema in `src/lib/env.ts` and add them to `.env.example`. Clerk's SDK reads them from `process.env` itself, so the declaration is there to fail fast with the project's message, satisfies **AC-19**
3. [x] Build `/sign-in/[[...sign-in]]` and `/sign-up/[[...sign-up]]` as catch all routes rendering `<SignIn />` and `<SignUp />` inside a centred frame matching `/`, satisfies **AC-1**
4. [x] Rewrite the `src/proxy.ts` matcher to fail closed: a `createRouteMatcher` public list of `/`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/webhooks/(.*)` and `/api/cron/(.*)`, everything else protected, satisfies **AC-4**
5. [x] Add a second matcher for the agency paths only, and redirect a signed in request to one of them with no `orgId` claim to `/onboarding`, decided from the session claims alone with no database call. `/onboarding` and `/portal` are outside that matcher by construction, satisfies **AC-5**, **AC-20**
6. [x] Write `src/db/tenant/provisioning.ts`: `createAgencyRows()` and `ensureMirrorRows()`, both inside the layer, both touching only the three identity tables, both upserting on their unique keys, exported from `src/db/tenant/index.ts`, satisfies **AC-13**, **AC-17**
7. [x] Write `src/auth/slug.ts`: one `uniqueSlug()` helper that derives a kebab slug from a name and suffixes it until free against `organizations.slug`. Both agency creation and the repair call it; neither ever reads Clerk's stored slug, satisfies **AC-10**
8. [x] Write `src/auth/agency.ts`: the `createAgency` Server Action, Zod parsed, re reading Clerk's membership count as a double submit guard, then calling Clerk and `createAgencyRows()` in one transaction and returning a `Result`, satisfies **AC-8**, **AC-9**, **AC-11**
9. [x] Build `/onboarding` with the create form only for now, plus the client side activation that awaits `setActive` before navigating, and add the welcome panel to `/dashboard` reading the agency name through `tenantDb(ctx)`. The thread now walks: sign up, create, land, see your own row, satisfies **AC-9**, **AC-15**

**Milestone 2: the repair path and the deleted filter**

10. [x] Write `src/auth/clerk.ts`: a thin wrapper over the Clerk backend API returning the organization and user records the mirror needs, with the email lowercased at that boundary and a 404 surfaced as its own distinct outcome rather than a generic failure, satisfies **AC-12**, **AC-21**
11. [x] Catch `no_mirror_row` in `src/app/(agency)/layout.tsx`, call `ensureMirrorRows()` (role from the session claim, slug from `uniqueSlug()`, all three writes `onConflictDoUpdate`), resolve again, and render; on a Clerk 404 redirect to `/onboarding` instead, and leave the normal path untouched, satisfies **AC-12**, **AC-13**, **AC-21**
12. [x] Add `deleted_at is null` to the staff resolution query in `src/db/tenant/context.ts` and note the amendment in spec 0003, satisfies **AC-14**
13. [x] Give `createAgency`'s failure path a retry message on the onboarding form that names the healing behaviour rather than showing an error page, satisfies **AC-11**
14. [x] Test the repair on a real PostgreSQL: missing rows repaired, concurrent repair idempotent, soft deleted organization treated as absent, a slug collision healed rather than repeated, and a Clerk 404 routed rather than thrown, satisfies **AC-10**, **AC-12**, **AC-13**, **AC-14**, **AC-21**

**Milestone 3: the other branches**

15. [x] Read the membership count from Clerk in `/onboarding` and branch: one activates and continues, several render a picker, none renders the create form. A membership always wins over a contact row, satisfies **AC-6**
16. [x] Add the client contact branch: call `contactContext()`, and on success redirect to `/portal`, satisfies **AC-7**
17. [x] Add a minimal `/portal` placeholder page inside the protected area but outside the agency organization check, clearly marked as owned by feature 15, and confirm a contact reloading it is not bounced to `/onboarding`, satisfies **AC-7**, **AC-20**
18. [x] Redirect a signed in person with an active organization away from `/sign-in` and `/sign-up` to `/dashboard`, and point sign out at `/`, satisfies **AC-16**

**Milestone 4: theming and accessibility**

19. [x] Map Clerk's `appearance` variables onto the spec 0004 tokens, defined once and shared by both components, satisfies **AC-3**
20. [x] Make the mapping follow the theme cookie in both directions with no flash of the wrong theme on load, satisfies **AC-3**
21. [x] Give `/onboarding` its loading, empty and error states, with the form's validation error tied to the field and announced, satisfies **AC-18**
22. [ ] Extend the axe run to `/sign-in`, `/sign-up` and `/onboarding` in both themes, and do the manual keyboard pass on the new routes, satisfies **AC-3**, **AC-18**

**Milestone 5: the fence and the test seam**

23. [x] Prove the fence holds: no new file imports `src/db/client.ts`, `withSystemAccess` is not imported anywhere new, and neither exemption list in `eslint.config.mjs` has grown, satisfies **AC-17**
24. [x] Keep `tools/eslint/tenant-isolation-config.test.mts` in step with the unchanged lists, and add a test asserting both proxy matchers match AC-4 and AC-5 exactly, including that `/onboarding` and `/portal` sit outside the organization check, satisfies **AC-4**, **AC-5**, **AC-17**, **AC-20**
25. [x] Add `@clerk/testing` as a dev dependency and document the browser suite's way in (Clerk testing tokens plus the dedicated development instance user and its two environment variables), without writing the test, satisfies **AC-19**

## Consequences

**Positive**:
- The agency area stops being publicly readable, which discharges the hazard spec 0004 knowingly left in `main` and unblocks feature 7.
- The matcher fails closed, so every route added after this one is protected unless someone deliberately makes it public. The default is now the safe one.
- The walking skeleton actually walks: a dashboard naming the agency from the local `organizations` row proves the Clerk session resolved a server side tenant context through spec 0003's layer, which no earlier feature could show.
- Every typed error spec 0003 invented is now routed. `no_mirror_row`, `no_active_org` and `no_contact` each have a destination, so the layer's taxonomy earns its keep.
- Spec 0001's safety net exists again, one layer up as spec 0003 required, so a webhook missed during a deploy never strands a user.
- Provisioning adds no new escape hatch. Two named functions inside the layer are narrower than `withSystemAccess`, and neither ESLint exemption list grows.

**Negative / tradeoffs**:
- A genuinely public route added later (the deferred marketing landing page, the legal pages) will silently require a session until someone adds it to the public list. Failing closed trades one failure mode for a quieter one.
- Clerk's `appearance` mapping is maintenance you now own. Clerk changing its component internals is a visual regression with no compile error behind it.
- Once feature 17 ships there are two writers for the mirror rows, this feature's provisioning and the webhook. They have to agree on what each column holds, and a disagreement shows up as data that flickers.
- Agency creation is unlimited and unrated. One signed in account can create arbitrarily many agencies, and nothing in this feature stops it.
- The repair path calls the Clerk backend API twice, so a rare request gets meaningfully slower and is subject to Clerk's own rate limits. That is the right trade for a valid row, but it is a real cost on the worst request rather than the average one.
- `/onboarding` asks Clerk for the membership count on every view, and agency creation asks again as its double submit guard. Those are cheap calls on a page nobody visits often, but they are Clerk API calls on a free tier with its own ceilings, and nothing here caches or backs off.
- The local slug and the Clerk organization slug can diverge after a collision race. Nothing today reads either one, but anything that later assumes they match will be wrong.
- `/portal` ships as a placeholder that tells a client contact almost nothing until feature 15.

**Neutral**:
- No migration and no schema change, so the database work in this feature is writes against tables that already exist.
- `src/auth/` is created here as the feature folder root AGENTS.md's layout already anticipates.
- `/onboarding` reads membership from Clerk rather than the local table, which is a small precedent worth being aware of: Clerk is authoritative for membership, the local column is a display mirror.

## Follow-up

- [ ] The ten `clerk*` skills are installed in `.agents/skills/` but named in no `AGENTS.md`. Auth conventions are area specific, so they belong in a new `src/auth/AGENTS.md` with a one line pointer from root, not in root `AGENTS.md` itself which loads on every task
- [ ] Spec 0003 needs a pointer to this spec's amendment of its staff resolution query (the `deleted_at is null` predicate), the way spec 0001 already carries a pointer to spec 0003's amendment of the repair promise
- [ ] Spec 0004's follow up "feature 6 must narrow the middleware matcher" is discharged by AC-4; tick it when this ships
- [ ] Agency creation is not rate limited, so one account can create unlimited agencies. Feature 19 covers invitation sends and upload URL signing only; consider adding this action to its ceiling list
- [ ] The Playwright sign up test is specified here but written by `/test`. If the Clerk testing token setup turns out to need more than the two documented environment variables, record the difference back here
- [ ] `/portal` is a placeholder created by this feature and owned by feature 15. It should be replaced, not extended
