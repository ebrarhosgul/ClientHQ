# Scope: Agency Client Portal

A multi tenant portal where agencies manage their clients, projects, deliverables and invoices, and each of their clients gets a read only window onto their own work. Agencies pay a monthly subscription; no client money moves through the platform.

**Build approach:** Tracer Bullet (prove the whole pipe works end to end before building any part of it fully).
**Workflow:** GA (after `/develop`: `/check verify`, then `/test`, then a fresh model `/check review`, then `/document`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Beta`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | done |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model & migrations | Foundation | in-progress |
| 4 | Tenant scoping data access layer | Foundation | in-progress |
| 5 | Design system & UI foundation | Foundation | done |
| 6 | Agency sign in & organization | Slice 1 | in-progress |
| 7 | Client records | Slice 1 | in-progress |
| 8 | Subscription checkout & Stripe webhook | Slice 2 | in-progress |
| 9 | Subscription access gate | Slice 2 | in-progress |
| 10 | Client contacts & portal invitations | Slice 3 | in-progress |
| 11 | Projects | Slice 4 | in-progress |
| 12 | Deliverable upload & download | Slice 5 | in-progress |
| 13 | Invoice authoring & lifecycle | Slice 6 | planned |
| 14 | Invoice PDF | Slice 6 | planned |
| 15 | Client portal | Slice 7 | planned |
| 16 | Team members & roles | Slice 8 | planned |
| 17 | Clerk webhook sync | Slice 8 | planned |
| 18 | Daily cron sweeps | Slice 9 | planned |
| 19 | Rate limiting | Slice 9 | planned |
| 20 | Product analytics & error tracking | Slice 9 | planned |

## Foundations

### 1. Stack & architecture · done · Beta
The stack, the tenancy model and the foundational architecture, plus a runnable project so every later slice builds on real structure. Already decided in spec 0001; what remains is the scaffold.
**Done when:** the empty scaffold boots locally, deploys to Vercel, connects to Supabase through Drizzle, and passes a clean build.
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
- [x] Verify it: `/check verify stack & architecture`
- [x] Test it: `/test stack & architecture`
Spec 0001 · code in `src/`, `drizzle.config.ts`, `scripts/db-check.ts`

_Tagged `Beta` because a scaffold has no user facing behavior for a fresh model review or a release note to describe. `/develop` derives the scaffold steps from spec 0001 at build time; they are deliberately not duplicated here._

### 2. Coding standards & tooling · done
Capture the real conventions from the scaffolded project, then install lint, format, type strictness, `pre-commit` hooks and CI so all later code is held to them. Includes the ESLint rule spec 0001 requires: nothing outside the data access layer may import the raw database handle.
**Done when:** root `AGENTS.md` reflects the real stack and the installed skills, lint, format and typecheck run clean, and the raw database handle import rule actually fails a build when violated.
- [ ] Capture conventions + tooling choices: `/audit` · skipped, `AGENTS.md` is already written and committed
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test tooling`
Tooling choices in [AGENTS.md](../../AGENTS.md) `## Tooling` · code in `prettier.config.mjs`, `eslint.config.mjs`, `tools/eslint/`, `.githooks/`, `scripts/migrations-check.ts`, `.github/workflows/ci.yml` · verify steps in [docs/verify/0002-coding-standards-and-tooling.md](../verify/0002-coding-standards-and-tooling.md)

_Tagged `Alpha` in spirit: this is configuration, so the closing stages are a clean run rather than a review. Comes after the scaffold, never before, because `/audit` reads the real project instead of guessing._

### 3. Data model & migrations · in-progress
Every table, column, constraint, index and cascade behind the product: organizations, users, memberships, subscriptions, clients, contacts, projects, deliverables, invoices, line items and the webhook idempotency ledger. Spec 0001 sketched the entities; this settles the real schema.
**Done when:** migrations apply cleanly to a fresh database and roll forward on an existing one, every tenant scoped table carries and indexes `org_id`, money is integer cents with an explicit currency, and the invoice number uniqueness constraint holds under concurrent inserts.
- [x] Design it (spec): `/architect data model & migrations`
- [x] Build it: `/develop data model & migrations`
  - [x] Foundations and a proven pipe: shared column helpers, `organizations`, the first migration, and both CI jobs (apply to a throwaway container, migrate on merge) · AC-1, AC-2, AC-6, AC-7, AC-8, AC-13
  - [x] Identity and clients: `users`, `memberships`, `subscriptions`, `clients`, `client_contacts`, plus the scrub helper and the lowercase email rule · AC-2, AC-6, AC-11, AC-12
  - [x] Delivery and invoicing: `projects`, `deliverables`, `invoices`, `invoice_line_items`, `processed_webhook_events`, the RESTRICT foreign keys, the money constraints and the relations · AC-2, AC-3, AC-4, AC-5, AC-6
  - [x] One baseline migration: squash to a single generated migration and prove it applies to a fresh database · AC-1, AC-7, AC-8
  - [x] Money helpers, drizzle-zod schemas and the guarded seed script · AC-3, AC-5, AC-9, AC-10
- [x] Verify it: `/check verify data model & migrations`
- [x] Test it: `/test data model & migrations`
- [ ] Review it (fresh model): `/check review data model & migrations`
- [x] Document it: `/document data model & migrations`
Spec [0002](../specs/0002-data-model-and-migrations/index.md) · atomic build tasks in its `## Build plan` · code in `src/db/schema/`, `drizzle/`, `src/lib/id.ts`, `src/lib/money.ts`, `src/lib/scrub.ts`, `scripts/db-schema-assert.ts`, `scripts/db-seed.ts`, `.github/workflows/migrate.yml`, `vercel.json`

### 4. Tenant scoping data access layer · in-progress
The single shared layer every read and write goes through, so no screen or action can reach another agency's rows. Covers resolving tenant context from the Clerk session or the contact row, the scoped query builder, the `withTenantAction()` wrapper, and how the raw handle stays unreachable.
**Done when:** an unscoped query against a tenant table cannot be written without deliberately bypassing the helper, tenant context resolves from the session or the contact row and never from a URL or form field, and a cross tenant access attempt is proven to fail in a test.
- [x] Design it (spec): `/architect tenant scoping data access layer`
- [x] Build it: `/develop tenant scoping data access layer`
  - [x] One thread end to end on `clients`: the Clerk SDK and its env vars, the single session module, staff context resolution, a scoped accessor and a minimal action wrapper, proven by the first cross tenant test on a real PostgreSQL · AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9
  - [x] Generalise the accessor over all eight tenant tables: generic over any table carrying `org_id`, the full method set, and the fenced escape hatch · AC-1, AC-2, AC-3
  - [x] The second audience: contact resolution from the verified cookie, the client narrowing map, the split staff and contact accessor types, and the portal isolation tests · AC-4, AC-5, AC-6
  - [x] The full write path: role guards, declared revalidation, opt in transactions, the reserved slots for features 9 and 19, and the refusal log · AC-10, AC-11, AC-14, AC-15
  - [x] The fence and the proof on every push: named system access for webhooks and cron, the narrowed ESLint exemptions with their test, and the tenancy suite running in CI · AC-12, AC-13, AC-16, AC-17
- [x] Verify it: `/check verify tenant scoping data access layer`
- [x] Test it: `/test tenant scoping data access layer`
- [ ] Review it (fresh model): `/check review tenant scoping data access layer`
- [ ] Document it: `/document tenant scoping data access layer`
Spec [0003](../specs/0003-tenant-scoping-data-access-layer/index.md) · atomic build tasks in its `## Build plan` · code in `src/db/tenant/`, `src/lib/env.ts`, `src/db/client.ts`, `eslint.config.mjs`, `tools/eslint/`, `.github/workflows/ci.yml`

_This is the row that carries the most risk in the whole plan. Spec 0001 is explicit that this scoping fails open: one query that bypasses the helper leaks data across tenants and nothing in the database stops it._

### 5. Design system & UI foundation · done · Beta
The visual direction, layout primitives, the agency dashboard shell and the base components every screen is assembled from, accessible by default so each later screen inherits it rather than fixing it.
**Done when:** `design.md` covers type, color, spacing and the component set, base components handle focus and keyboard properly, and the shell renders in the real app against WCAG 2.2 AA.
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
  - [x] One thread end to end: Inter and JetBrains Mono, the full token layer in both themes, the contrast test that enforces it, the first primitive, the theme cookie round trip, the rebuilt entry page, and axe plus a browser job in CI · AC-2, AC-3, AC-5, AC-8, AC-9, AC-15, AC-17, AC-19, AC-23
  - [x] The primitives and the gallery: the core set in `src/ui/primitives/`, the form field wrapper, and `/design` showing every component in every state in both themes · AC-4, AC-13, AC-16, AC-19, AC-21
  - [x] The patterns: status chip, empty and error states, the responsive column priority table, the skeleton convention and the toast rules · AC-10, AC-11, AC-12, AC-13, AC-14, AC-21
  - [x] The shell and the real route: `ClerkProvider` and a deliberately permissive `src/proxy.ts`, the sidebar and top bar, the mobile sheet, and `/dashboard` rendering it · AC-6, AC-7, AC-18, AC-22, AC-23
  - [x] Write it down and prove the rest by hand: `design.md`, `src/ui/AGENTS.md`, and the manual accessibility pass · AC-1, AC-5, AC-20, AC-21 · the written parts landed; the manual keyboard and screen reader pass (spec task 27) is still open and belongs to `/check verify`
- [ ] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`
Spec [0004](../specs/0004-design-system-and-ui-foundation/index.md) · atomic build tasks in its `## Build plan` · verify steps in its [verify.md](../specs/0004-design-system-and-ui-foundation/verify.md) · design system in [design.md](../../design.md) · code in `src/ui/`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/design/`, `src/app/(agency)/`, `src/proxy.ts`, `e2e/`, `components.json`, `.github/workflows/ci.yml`

_Spec 0001 asks for this explicitly, so `/develop` is not left inventing a look from shadcn defaults. Tagged `Beta`: verifying it renders and passes accessibility is the valuable part; a release note is not._

_Spec 0004 pulls one thing forward from feature 6: it wires `ClerkProvider` and a `src/proxy.ts` that leaves every route public, so the shell shows a real agency name. **Feature 6 must narrow that matcher before feature 7 puts real client rows behind an agency route.**_

## Slice 1: Core loop (the walking skeleton)

_The thinnest real thread through every layer: real auth, real database, real tenancy, real UI, really deployed. Narrow, not fake._

### 6. Agency sign in & organization · in-progress
Sign up, sign in, create an agency organization, and land on a dashboard shell that knows which organization you are acting as. The local mirror rows are upserted on demand so a user is never stranded.
**Done when:** a new person can sign up, create an agency, and land on a dashboard whose tenant context resolves from the Clerk session, with the local organization, user and membership rows present, all on the deployed app.
- [x] Design it (spec): `/architect agency sign in & organization`
- [x] Build it: `/develop agency sign in & organization`
  - [x] One thread end to end: the Clerk application configured, the four URL variables, the two auth routes, the fails closed proxy with its agency organization check, the provisioning functions inside the tenant layer, the slug helper, the create action, `/onboarding`, and `/dashboard` naming the agency from your own row · AC-1, AC-2, AC-4, AC-5, AC-8, AC-9, AC-10, AC-13, AC-15, AC-17, AC-19, AC-20 · all the code landed; the Clerk dashboard settings (spec task 1) are a change only you can make, so AC-2 is unconfirmed until you switch Organizations on
  - [x] The repair path and the deleted filter: the Clerk backend wrapper, the lazy catch in the agency layout, the `deleted_at` predicate amending spec 0003, the retry message, and the proof on a real PostgreSQL · AC-10, AC-11, AC-12, AC-13, AC-14, AC-21
  - [x] The other branches: the membership count branch and its picker, the client contact redirect, the `/portal` placeholder, and the redirects for a signed in visitor and for sign out · AC-6, AC-7, AC-16, AC-20
  - [x] Theming and accessibility: Clerk's appearance mapped onto the spec 0004 tokens in both themes, the onboarding loading, empty and error states, and axe plus the manual pass on the new routes · AC-3, AC-18 · the mapping, the states and the axe run landed; the manual keyboard and screen reader pass (spec task 22) is still open and belongs to `/check verify`
  - [x] The fence and the test seam: proving neither ESLint exemption list grew, the tests pinning both proxy matchers, and the documented way in for the browser suite · AC-4, AC-5, AC-17, AC-19, AC-20
- [x] Verify it: `/check verify agency sign in & organization`
- [x] Test it: `/test agency sign in & organization`
- [x] Review it (fresh model): `/check review agency sign in & organization`
- [ ] Document it: `/document agency sign in & organization`
Spec [0005](../specs/0005-agency-sign-in-and-organization/index.md) · atomic build tasks in its `## Build plan` · verify steps in its [verify.md](../specs/0005-agency-sign-in-and-organization/verify.md) · code in `src/auth/`, `src/proxy.ts`, `src/app/(auth)/`, `src/app/portal/`, `src/app/(agency)/`, `src/db/tenant/provisioning.ts`, `src/db/tenant/organization.ts`, `src/db/tenant/context.ts`, `src/lib/env.ts`, `src/app/globals.css`, `e2e/`

_This is the row that discharges spec 0004's open hazard: `src/proxy.ts` leaves every route public today, and feature 7 must not start until this has narrowed it._

### 7. Client records
The first real tenant scoped write and read: add a client company, list clients, open one, edit and archive it. This closes the walking skeleton thread.
**Done when:** a signed in agency user can create, list, open, edit and archive a client, every query runs through the scoping layer, a second agency cannot see the first agency's clients, and the list handles its empty and error states at WCAG 2.2 AA.
- [x] Design it (spec): `/architect client records`
- [x] Build it: `/develop client records`
  - [x] The migration and the input schemas: the new columns (phone, industry, structured billing address, the lowercase email constraint) and the Zod schemas for create and update · AC-1, AC-2, AC-3
  - [x] One thread end to end: `createClient`, a minimal active only `/clients` list, and `/clients/new`, proving one agency's client stays invisible to another · AC-1, AC-4, AC-10, AC-11, AC-12
  - [x] Detail and edit: `/clients/[id]`, `updateClient`, `/clients/[id]/edit` · AC-6, AC-7, AC-11, AC-14
  - [x] Archive and restore: `archiveClient`, `restoreClient`, the confirm dialog, the active/archived toggle · AC-4, AC-8, AC-9
  - [x] Thicken the list and polish: page number pagination, name search, the empty and error states, and the accessibility pass · AC-4, AC-5, AC-13
- [ ] Verify it: `/check verify client records`
- [x] Test it: `/test client records`
- [x] Review it (fresh model): `/check review client records`
- [ ] Document it: `/document client records`
Spec [0006](../specs/0006-client-records/index.md) · atomic build tasks in its `## Build plan` · code in `src/db/schema/clients.ts`, `src/clients/`, `src/app/(agency)/clients/`, `src/ui/patterns/confirm-dialog.tsx`, `src/ui/patterns/address-fields.tsx`

## Slice 2: Subscription & access gate

_Thickening the identity segment into money. Built early because the gate constrains every screen that comes after it._

### 8. Subscription checkout & Stripe webhook · in-progress
The agency subscribes: a billing page offering Stripe Checkout, the Billing Portal once a customer exists, and the verified webhook that turns Stripe events into a local subscription row without duplicating or applying them out of order.
**Done when:** an agency can subscribe and cancel end to end, a replayed webhook event changes nothing, an out of order event still lands the correct state, and a failed state change rolls back so Stripe retries.
- [x] Design it (spec): `/architect subscription checkout & Stripe webhook`
- [ ] Build it: `/develop subscription checkout & Stripe webhook`
  - [x] Configuration and the pinned client: the four Stripe env vars in `src/lib/env.ts`, the Stripe dashboard prerequisites (product, Price carrying the 14 day trial, Portal, webhook endpoint and secret), and one Stripe client with an explicitly pinned `apiVersion` · AC-2, AC-4, AC-5
  - [ ] One thread end to end: `startCheckout()` behind an admin guard, the webhook route implementing the full six step order (verify, resolve, retrieve outside the transaction, conflict-do-nothing ledger insert, lock and apply, commit), and a minimal `/billing`, proven by a real test mode subscribe · AC-1, AC-2, AC-3, AC-4, AC-10, AC-11, AC-17, AC-20, AC-23, AC-24, AC-25
  - [x] The rest of the event set and its proofs: all six events applying retrieved state, the `metadata.org_id` fallback for an event that outran its session, the `past_due_since` rule, and the tests for replay, reordering, concurrency, rollback and poison events · AC-7, AC-8, AC-9, AC-12, AC-16, AC-22, AC-26
  - [x] The Portal and the duplicate customer holes: `openBillingPortal()`, the status driven action rule so a cancelled agency can resubscribe, the idempotency key, the `org_id` upsert, and the refusal of a conflicting customer id · AC-6, AC-14, AC-15, AC-18, AC-27
  - [ ] The real billing page: the status card in plain words, the trial end or renewal date, the member read only variant, the loading, empty and error states, the structured failure logging, and the accessibility pass · AC-5, AC-13, AC-19, AC-21
- [ ] Verify it: `/check verify subscription checkout & Stripe webhook`
- [x] Test it: `/test subscription checkout & Stripe webhook`
- [x] Review it (fresh model): `/check review subscription checkout & Stripe webhook`
- [ ] Document it: `/document subscription checkout & Stripe webhook`
Spec [0007](../specs/0007-subscription-checkout-and-stripe-webhook/index.md) · atomic build tasks in its `## Build plan` · code in `src/payments/`, `src/app/(agency)/billing/`, `src/app/api/webhooks/stripe/`, `src/lib/env.ts` · webhook proven against real PostgreSQL in `src/payments/webhook.db.test.ts`, page in `e2e/billing.spec.ts` · verify steps in [its `verify.md`](../specs/0007-subscription-checkout-and-stripe-webhook/verify.md)

_**Two milestones are built but unproven, and both wait on the same thing: a Stripe account.** All the code for the end to end thread and the billing page is written, typechecks and is tested; what has not happened is a real test mode subscribe, and an accessibility pass over the states that need a signed in session with a live subscription. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID` from the Stripe dashboard (`.env.example` lists the setup), then run `/check verify`._

_Ships with no migration: spec 0002 already built `subscriptions` and `processed_webhook_events`. Two Stripe fields moved to the subscription **item** in the Basil release (`current_period_end` and `price.id`), and reading the old path stores null silently rather than failing, so spec 0007 calls both out explicitly._

### 9. Subscription access gate · in-progress
Turning subscription state into what the agency may actually do: full access, a read only grace window, or locked out to billing only. Derived at read time so a grace window expires on its own.
**Done when:** each Stripe state produces the right access level, the grace window blocks writes while leaving reads working, a lapsed grace window locks without any scheduled job running, the banner links to the Billing Portal, and no data is ever deleted by the gate.
- [x] Design it (spec): `/architect subscription access gate`
- [x] Build it: `/develop subscription access gate`
  - [x] One thread end to end: the pure `accessVerdict` over every Stripe status, the `(gated)` route group with its redirecting layout and the `(agency)` error boundary, the `subscription_inactive` code, `requireFullAccess` wired into `withTenantAction()` before parsing with the two billing actions opted out, proven by a fresh agency reaching `/dashboard` only after subscribing and a hand set lapsed row being redirected and refused · AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-9, AC-13
  - [x] The grace window: the banner in its admin and member variants with the UTC end date, the refusal shown in forms with a link to `/billing`, and the order of checks and exemption list pinned by tests · AC-5, AC-6, AC-7
  - [x] Locked, logging and the edges: the role aware notice on `/billing`, refusal and invariant logging, the fail closed tests, the real PostgreSQL read test, and the reachable pages test · AC-4, AC-10, AC-11, AC-12
  - [x] Accessibility and the seed: axe on both themes, the manual keyboard and screen reader pass, a `past_due` agency in the seed, and the new states in `/design` · AC-14
- [x] Verify it: `/check verify subscription access gate`
- [x] Test it: `/test subscription access gate`
- [x] Review it (fresh model): `/check review subscription access gate`
- [ ] Document it: `/document subscription access gate`
Spec [0008](../specs/0008-subscription-access-gate/index.md) · atomic build tasks in its `## Build plan` · code in `src/access/`, `src/app/(agency)/(gated)/`, `src/app/(agency)/error.tsx`, `src/db/tenant/subscription.ts`, `src/db/tenant/action.ts`, `src/db/tenant/errors.ts`, `src/payments/subscription-status.ts`, `src/ui/patterns/action-error.tsx` · gate proven against real PostgreSQL in `src/access/gate.db.test.ts`, route tree pinned in `src/app/(agency)/(gated)/routes.test.ts` · verify steps in [its `verify.md`](../specs/0008-subscription-access-gate/verify.md)

_Ships with no migration and no new environment variable: the gate reads `status` and `past_due_since` from the row spec 0007 writes. `/billing` and `/settings` stay outside the gated route group on purpose, so a lapsed agency can always pay. The client portal rule (locked agency, unavailable portal) is fixed here and applied by feature 15._

## Slice 3: Client contacts & portal invitations

### 10. Client contacts & portal invitations · in-progress
Add named contacts to a client and invite them to the portal by email. Introduces transactional email to the product, which later features reuse. Includes the acceptance flow that binds a contact to a real signed in user.
**Done when:** staff can add a contact and send an invitation, the emailed link expires, only a hash of the token is stored, acceptance requires the signed in user's verified email to match the contact, and a forwarded link cannot be used to claim someone else's contact.
- [x] Design it (spec): `/architect client contacts & portal invitations`
- [x] Build it: `/develop client contacts & portal invitations`
  - [x] One thread end to end: the `invited_by_user_id` migration, the email transport with its console fallback, the pure token, limits and status modules, `addContact` and a minimal `sendInvitation`, a bare Contacts section, the acceptance door in `src/db/tenant/invitation.ts`, the `/portal/accept` page and the accept action that binds, sets the contact cookie and lands on `/portal`, proven on a second Clerk account through the brand new account path · AC-1, AC-3, AC-5, AC-9, AC-10, AC-13
  - [x] The invitation lifecycle: cooldown and daily cap, resend and revoke, the send failure path and the `unsent` status, edit with the pending clear and the accepted email lock, remove with its confirm dialog, and the five status badges with their action sets · AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-14
  - [x] Acceptance edges and the fence: the already yours and wrong account states, the unverified email and archived client refusals, the concurrent accept, cross tenant and contact context refusals, the subscription gate on staff writes with acceptance left open, and the structured log lines · AC-9, AC-10, AC-11, AC-12, AC-13, AC-15
  - [x] The email and the screens: the finished React Email template with plain text, envelope and idempotency key, the production key requirement, empty and error states, `/design` entries, axe in both themes, and the Playwright walk · AC-5, AC-12, AC-14
- [x] Verify it: `/check verify client contacts & portal invitations`
- [x] Test it: `/test client contacts & portal invitations`
- [x] Review it (fresh model): `/check review client contacts & portal invitations`
- [ ] Document it: `/document client contacts & portal invitations`
Spec [0009](../specs/0009-client-contacts-portal-invitations/index.md) · atomic build tasks in its `## Build plan` · code in `src/contacts/`, `src/email/`, `src/db/tenant/invitation.ts`, `src/app/portal/accept/`, `src/app/(agency)/(gated)/clients/[id]/page.tsx` (the Contacts section), `drizzle/0002_faithful_marauders.sql` · actions and the acceptance door proven against real PostgreSQL in `src/contacts/contacts.db.test.ts`, the screens in `src/contacts/ui/*.test.tsx` and `e2e/contacts.spec.ts`

_Settles the invitation send half of feature 19 (a per contact cooldown and a per agency daily cap counted from `invited_at`, no Upstash), drops the `INVITE_TOKEN_SECRET` spec 0001 planned in favour of a hashed random token, and stands up `src/email/` for features 13 and 18 to reuse._

## Slice 4: Projects

### 11. Projects · in-progress
The unit of work an agency delivers: create a project under a client, move it through its stages, set a due date, and see it in a list and on its own page.
**Done when:** staff can create, list, open, edit and archive a project under a client, status moves only through valid transitions, everything stays inside the acting agency, and the screens meet WCAG 2.2 AA including empty and error states.
- [x] Design it (spec): `/architect projects`
- [x] Build it: `/develop projects`
  - [x] One thread end to end: the pure status module, the conditional `update` in the tenant layer, the input schemas, `createProject` with the active client picker, a minimal `/projects` list replacing the reserved placeholder, and `/projects/[id]` with the overdue badge, proven invisible to a second agency · AC-1, AC-2, AC-3, AC-4, AC-6, AC-15, AC-16
  - [x] The workflow: one button per valid move with the compare and set and the conflict refresh, the deliver confirm, edit with a clearable due date, and admin only archive and restore with the controls hidden from a member · AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-18
  - [x] The lists: status, client and archived filters with paging and the unresolvable client rule, the client page's Projects section with its New project and archived links, and the active project count in the archive client confirm · AC-4, AC-5, AC-13, AC-14
  - [x] Empty and error states, the Deliverables placeholder, `/design` entries for the move buttons, the overdue badge and the client picker, and axe in both themes · AC-6, AC-17
- [ ] Verify it: `/check verify projects`
- [x] Test it: `/test projects`
- [x] Review it (fresh model): `/check review projects`
- [ ] Document it: `/document projects`
Spec [0010](../specs/0010-projects/index.md) · atomic build tasks in its `## Build plan` · no migration, the `projects` table from spec 0002 is unchanged · code in `src/projects/`, `src/app/(agency)/(gated)/projects/`, `src/db/tenant/accessor.ts`, `src/clients/queries.ts`, `src/clients/ui/archive-client-button.tsx`, `src/app/(agency)/(gated)/clients/[id]/page.tsx`, `src/app/design/gallery.tsx`

_Settles spec 0006's open question about archiving a client with projects (a count in the confirm, never a block), adds the first admin only actions on the existing `requireRole` option, and gives the tenant layer's `update` an optional condition that feature 13's issue and pay moves should reuse._

## Slice 5: Deliverables

### 12. Deliverable upload & download · in-progress
Attaching real files to a project, uploaded straight to storage so bytes never pass through the server, with a per file switch for whether the client may see it.
**Done when:** a file uploads directly with a short lived signed URL, the confirmed size and type are read back from storage rather than trusted from the browser, an unconfirmed upload is never listed or downloadable, downloads are permission checked and time limited, and deleting removes the stored object before the row.
- [x] Design it (spec): `/architect deliverable upload & download`
- [x] Build it: `/develop deliverable upload & download`
  - [x] The storage port and one thread end to end: the `R2_*` variables, `src/storage/` on the AWS S3 SDK with its in memory fake and the signing tests, the file rules and schemas, `requestUpload` and `confirmUpload`, a minimal Deliverables list replacing the placeholder, the browser upload with progress, and the staff download route, proven with one real upload · AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-9, AC-10, AC-12, AC-16, AC-18
  - [x] The upload's failure paths and management: `abandonUpload`, the confirm retry and its result copies, the archived project rule, the not configured notice, the visibility switch, and delete behind a confirm with object first removal · AC-1, AC-6, AC-7, AC-8, AC-9, AC-11, AC-15, AC-17, AC-18
  - [x] The contact download rule, the missing file and storage not configured pages, and `scripts/r2-setup.ts` with the `verify.md` steps for buckets, tokens, CORS and the wrong content type refusal · AC-4, AC-12, AC-13, AC-14, AC-18, AC-19
  - [x] Empty and error states, `/design` entries for every new piece, `e2e/deliverables.spec.ts`, and axe in both themes · AC-10, AC-20
- [x] Verify it: `/check verify deliverable upload & download`
- [x] Test it: `/test deliverable upload & download`
- [ ] Review it (fresh model): `/check review deliverable upload & download`
- [ ] Document it: `/document deliverable upload & download`
Spec [0011](../specs/0011-deliverable-upload-download/index.md) · atomic build tasks in its `## Build plan` · no migration, the `deliverables` table from spec 0002 is unchanged · new area `src/storage/`, feature code in `src/deliverables/`, the download route at `src/app/deliverables/[id]/download/`, `scripts/r2-setup.ts`, `src/lib/env.ts`, `eslint.config.mjs`

## Slice 6: Invoices

### 13. Invoice authoring & lifecycle · needs a decision
Building an invoice from line items and moving it through draft, sent, paid, overdue and void. Numbers are assigned on issue so issued invoices form a gapless sequence, and issuing notifies the client contacts.
**Done when:** staff can draft an invoice with line items, issue it to assign its number and freeze the items, mark it paid or void it, totals are computed in integer cents, concurrent issues never collide on a number, and drafts and voided invoices stay invisible to clients.
- [ ] Design it (spec): `/architect invoice authoring & lifecycle`

### 14. Invoice PDF · needs a decision
A downloadable file the client can save and forward to their own accountant. New work that spec 0001 does not cover, so it carries its own decision about how the document is produced and where it is stored or generated.
**Done when:** an issued invoice downloads as a PDF that matches the on screen invoice exactly, is reachable by both the agency and the invoiced client, and is refused for drafts and voided invoices.
- [ ] Design it (spec): `/architect invoice PDF`

## Slice 7: Client portal

### 15. Client portal · needs a decision
The client's own read only view: their projects, the deliverables the agency chose to share, and their invoices. Nothing else is reachable, ever.
**Done when:** a signed in contact sees only their own client's active projects, only deliverables marked visible and confirmed, and only issued, paid or overdue invoices, with a contact of one client provably unable to reach another client's data, and the whole portal meeting WCAG 2.2 AA.
- [ ] Design it (spec): `/architect client portal`

## Slice 8: Team & identity sync

### 16. Team members & roles · needs a decision
Growing an agency past one person: invite staff, see the member list, change roles, remove people, and enforce what an admin may do that a member may not.
**Done when:** an admin can invite, list, re role and remove staff, a member is refused billing and member management at the server and not just hidden in the UI, and permission checks read the authoritative session role rather than the local mirror.
- [ ] Design it (spec): `/architect team members & roles`

### 17. Clerk webhook sync · needs a decision
Keeping the local mirror of users, organizations and memberships current as they change in Clerk, on the same verified and idempotent shape as the Stripe webhook.
**Done when:** each consumed event updates the mirror correctly, a replayed event changes nothing, deletions soft delete rather than destroy, and an event missed during a deploy is recovered without manual intervention.
- [ ] Design it (spec): `/architect Clerk webhook sync`

## Slice 9: Operations & release readiness

### 18. Daily cron sweeps · needs a decision
One guarded scheduled route doing every daily sweep in sequence: marking invoices overdue, clearing abandoned uploads and their stored objects, and keeping the database from going idle.
**Done when:** the route refuses an unauthenticated call, marks the right invoices overdue and no others, removes abandoned uploads along with their stored objects, and a failure in one sweep does not silently skip the rest.
- [ ] Design it (spec): `/architect daily cron sweeps`

### 19. Rate limiting · needs a decision
Putting a ceiling on the two actions a signed in user could otherwise abuse: sending invitations and requesting signed upload URLs.
**Done when:** each limited action refuses politely past its ceiling with a clear message, limits apply per agency rather than globally, and the limiter failing does not take the whole action down with it.
- [ ] Design it (spec): `/architect rate limiting`

### 20. Product analytics & error tracking · needs a decision
Knowing what happens in production: errors and traces across server and browser, plus product analytics for which signups actually activate and which convert to a subscription.
**Done when:** server and browser errors arrive with useful context and source maps, the conversion events you care about are recorded, and neither collector leaks personal data or blows through a free tier quota.
- [ ] Design it (spec): `/architect product analytics & error tracking`

## Deferred
Out of scope for the current build pass, kept so the plan stays honest.
- **Marketing landing page & SEO**: a public page with metadata, sitemap and social cards. You left it out, so `/` stays a minimal entry point to sign in and sign up · needs a decision
- **Legal pages & cookie consent**: privacy policy, terms, consent banner. Becomes required rather than optional if real agencies ever sign up · needs a decision
- **Seeded demo account**: a read only account with realistic data so a reviewer can walk the app without signing up. Spec 0001 lists this as a follow up. Spec 0002 ships a guarded local seed script, which is most of the data work · needs a decision
- **Agency timezone**: no timezone is modelled, so invoice issue dates and the overdue sweep use UTC. An invoice issued late in the evening on the west coast gets tomorrow's date. Spec 0002 has the application supply both dates, so the fix is one `organizations.timezone` column plus a helper. Spec 0010 reuses the UTC day for a project's overdue badge and its `isOverdue` already takes today as a parameter, so the same column fixes both · from spec 0002 and spec 0010 · needs a decision
- **Postgres row level security**: a second line of defence that fails closed instead of open. Spec 0001 calls this the single biggest security upgrade available to the design. Spec 0002 left it unblocked (`org_id` is not null on every tenant table) and spec 0003 has now settled the shape it needs: one choke point in the data access layer, so switching it on is a dedicated application database role, a policy migration across the eight tenant tables, and a change to that one function. Spec 0003 names the trigger for doing it: the first moment two real agencies share the database · from spec 0003 · needs a decision
- **Colour token lint rule**: a `clienthq/no-literal-colour` ESLint rule in the shape of the existing `clienthq/no-raw-db-import`, catching both a raw hex value and an opacity modifier on a colour token. Spec 0004 makes "every colour comes from a token" a load bearing invariant and then enforces it by review, which is the weaker half of what the project already does for the database handle. The opacity case is the one the contrast test cannot see · from spec 0004 · needs a decision
- **Agency branding in the portal**: no logo upload, no per agency colour, no white labelling. Spec 0004 gives the client portal ClientHQ's own chrome, so a client sees your product rather than their agency's. If real agencies ask for their logo on the portal their clients see, that is a new decision and it reaches into the tokens · from spec 0004 · needs a decision
- **Agency creation is not rate limited**: any signed in account can create unlimited agencies, because spec 0005 deliberately allows a person to belong to several. Feature 19's ceilings cover invitation sends and upload URL signing only, so this action belongs on that list when it is built · from spec 0005 · needs a decision
- **Subscription drift detection**: nothing currently notices when the Stripe webhook stops working. A misconfigured endpoint, or one Stripe disables after repeated failures, freezes the local subscription mirror silently, and feature 9 then turns that stale row into a lockout for an agency that is paying. The fix is a nightly reconcile that lists active Stripe subscriptions and repairs any local row that disagrees, so feature 18 is its natural home rather than a feature of its own. Worth settling when feature 18 is designed, and worth not forgetting before feature 9 reaches production · from spec 0007 · needs a decision
- **Gate re check on client side navigation**: a Next.js layout does not re render on a client side navigation, so an agency whose grace window lapses mid session keeps reading until its next full page load. Writes are refused immediately by the wrapper, so the gap is read only and bounded. Worth measuring once real agencies exist; `template.tsx` in the `(gated)` group is the first thing to try if it matters · from spec 0008 · needs a decision
- **Preview environment file storage**: R2's CORS rule is per bucket and per origin, so each Vercel preview URL that needs real uploads needs its own bucket run through `pnpm r2:setup`, or previews run with storage unconfigured (which spec 0011 supports with a visible notice). Decide between one shared preview bucket with a wildcard origin rule and per preview buckets if previews ever need real files · from spec 0011 · needs a decision
- **Audit log**: who did what, deliberately left out of the first schema. Spec 0002 raises a narrower and much cheaper version worth doing first: one append only `invoice_events` table (invoice id, from status, to status, actor, timestamp), best added while feature 13 writes the invoice tables, because history not recorded then cannot be recovered later · from spec 0002 · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | **`/architect` at spec capture** | `Design it` ticked; spec linked; `Build it: /develop <feature>` + **2 to 5 milestones**; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` + `Document it` GA); any surfaced follow-up enrolled |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | **you, when you decide it is** (any skill sets it when you say so); `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` → after `/develop`; `Alpha` → after `/check verify`; `Beta`/`GA` → after `/test`) is the suggested point to call it done; `/sync` captures conventions |

- **Next step** = the first unticked box (always a command or a tracked milestone).
- **needs a decision** = run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards & tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (pre-workflow) and `dropped` (de-scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag = inherits it.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default. It decides the feature's check boxes and each skill's next suggestion.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** = nothing (trust develop's own build time self check); **Alpha** = `/check verify`; **Beta** = `/check verify` then `/test`; **GA** = adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
