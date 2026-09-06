# Scope: Agency Client Portal

A multi tenant portal where agencies manage their clients, projects, deliverables and invoices, and each of their clients gets a read only window onto their own work. Agencies pay a monthly subscription; no client money moves through the platform.

**Build approach:** Tracer Bullet (prove the whole pipe works end to end before building any part of it fully).
**Workflow:** GA (after `/develop`: `/check verify`, then `/test`, then a fresh model `/check review`, then `/document`). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Beta`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack & architecture | Foundation | in-progress |
| 2 | Coding standards & tooling | Foundation | done |
| 3 | Data model & migrations | Foundation | in-progress |
| 4 | Tenant scoping data access layer | Foundation | planned |
| 5 | Design system & UI foundation | Foundation | planned |
| 6 | Agency sign in & organization | Slice 1 | planned |
| 7 | Client records | Slice 1 | planned |
| 8 | Subscription checkout & Stripe webhook | Slice 2 | planned |
| 9 | Subscription access gate | Slice 2 | planned |
| 10 | Client contacts & portal invitations | Slice 3 | planned |
| 11 | Projects | Slice 4 | planned |
| 12 | Deliverable upload & download | Slice 5 | planned |
| 13 | Invoice authoring & lifecycle | Slice 6 | planned |
| 14 | Invoice PDF | Slice 6 | planned |
| 15 | Client portal | Slice 7 | planned |
| 16 | Team members & roles | Slice 8 | planned |
| 17 | Clerk webhook sync | Slice 8 | planned |
| 18 | Daily cron sweeps | Slice 9 | planned |
| 19 | Rate limiting | Slice 9 | planned |
| 20 | Product analytics & error tracking | Slice 9 | planned |

## Foundations

### 1. Stack & architecture · in-progress · Beta
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
- [ ] Build it: `/develop data model & migrations`
  - [x] Foundations and a proven pipe: shared column helpers, `organizations`, the first migration, and both CI jobs (apply to a throwaway container, migrate on merge) · AC-1, AC-2, AC-6, AC-7, AC-8, AC-13
  - [ ] Identity and clients: `users`, `memberships`, `subscriptions`, `clients`, `client_contacts`, plus the scrub helper and the lowercase email rule · AC-2, AC-6, AC-11, AC-12
  - [ ] Delivery and invoicing: `projects`, `deliverables`, `invoices`, `invoice_line_items`, `processed_webhook_events`, the RESTRICT foreign keys, the money constraints and the relations · AC-2, AC-3, AC-4, AC-5, AC-6
  - [ ] One baseline migration: squash to a single generated migration and prove it applies to a fresh database · AC-1, AC-7, AC-8
  - [ ] Money helpers, drizzle-zod schemas and the guarded seed script · AC-3, AC-5, AC-9, AC-10
- [ ] Verify it: `/check verify data model & migrations`
- [ ] Test it: `/test data model & migrations`
- [ ] Review it (fresh model): `/check review data model & migrations`
- [ ] Document it: `/document data model & migrations`
Spec [0002](../specs/0002-data-model-and-migrations/index.md) · atomic build tasks in its `## Build plan`

### 4. Tenant scoping data access layer · needs a decision
The single shared layer every read and write goes through, so no screen or action can reach another agency's rows. Covers resolving tenant context from the Clerk session or the contact row, the scoped query builder, the `withTenantAction()` wrapper, and how the raw handle stays unreachable.
**Done when:** an unscoped query against a tenant table cannot be written without deliberately bypassing the helper, tenant context resolves from the session or the contact row and never from a URL or form field, and a cross tenant access attempt is proven to fail in a test.
- [ ] Design it (spec): `/architect tenant scoping data access layer`

_This is the row that carries the most risk in the whole plan. Spec 0001 is explicit that this scoping fails open: one query that bypasses the helper leaks data across tenants and nothing in the database stops it._

### 5. Design system & UI foundation · needs a decision · Beta
The visual direction, layout primitives, the agency dashboard shell and the base components every screen is assembled from, accessible by default so each later screen inherits it rather than fixing it.
**Done when:** `design.md` covers type, color, spacing and the component set, base components handle focus and keyboard properly, and the shell renders in the real app against WCAG 2.2 AA.
- [ ] Design it (spec): `/architect design system & UI foundation`

_Spec 0001 asks for this explicitly, so `/develop` is not left inventing a look from shadcn defaults. Tagged `Beta`: verifying it renders and passes accessibility is the valuable part; a release note is not._

## Slice 1: Core loop (the walking skeleton)

_The thinnest real thread through every layer: real auth, real database, real tenancy, real UI, really deployed. Narrow, not fake._

### 6. Agency sign in & organization · needs a decision
Sign up, sign in, create an agency organization, and land on a dashboard shell that knows which organization you are acting as. The local mirror rows are upserted on demand so a user is never stranded.
**Done when:** a new person can sign up, create an agency, and land on a dashboard whose tenant context resolves from the Clerk session, with the local organization, user and membership rows present, all on the deployed app.
- [ ] Design it (spec): `/architect agency sign in & organization`

### 7. Client records · needs a decision
The first real tenant scoped write and read: add a client company, list clients, open one, edit and archive it. This closes the walking skeleton thread.
**Done when:** a signed in agency user can create, list, open, edit and archive a client, every query runs through the scoping layer, a second agency cannot see the first agency's clients, and the list handles its empty and error states at WCAG 2.2 AA.
- [ ] Design it (spec): `/architect client records`

## Slice 2: Subscription & access gate

_Thickening the identity segment into money. Built early because the gate constrains every screen that comes after it._

### 8. Subscription checkout & Stripe webhook · needs a decision
The agency subscribes: a billing page offering Stripe Checkout, the Billing Portal once a customer exists, and the verified webhook that turns Stripe events into a local subscription row without duplicating or applying them out of order.
**Done when:** an agency can subscribe and cancel end to end, a replayed webhook event changes nothing, an out of order event still lands the correct state, and a failed state change rolls back so Stripe retries.
- [ ] Design it (spec): `/architect subscription checkout & Stripe webhook`

### 9. Subscription access gate · needs a decision
Turning subscription state into what the agency may actually do: full access, a read only grace window, or locked out to billing only. Derived at read time so a grace window expires on its own.
**Done when:** each Stripe state produces the right access level, the grace window blocks writes while leaving reads working, a lapsed grace window locks without any scheduled job running, the banner links to the Billing Portal, and no data is ever deleted by the gate.
- [ ] Design it (spec): `/architect subscription access gate`

## Slice 3: Client contacts & portal invitations

### 10. Client contacts & portal invitations · needs a decision
Add named contacts to a client and invite them to the portal by email. Introduces transactional email to the product, which later features reuse. Includes the acceptance flow that binds a contact to a real signed in user.
**Done when:** staff can add a contact and send an invitation, the emailed link expires, only a hash of the token is stored, acceptance requires the signed in user's verified email to match the contact, and a forwarded link cannot be used to claim someone else's contact.
- [ ] Design it (spec): `/architect client contacts & portal invitations`

## Slice 4: Projects

### 11. Projects · needs a decision
The unit of work an agency delivers: create a project under a client, move it through its stages, set a due date, and see it in a list and on its own page.
**Done when:** staff can create, list, open, edit and archive a project under a client, status moves only through valid transitions, everything stays inside the acting agency, and the screens meet WCAG 2.2 AA including empty and error states.
- [ ] Design it (spec): `/architect projects`

## Slice 5: Deliverables

### 12. Deliverable upload & download · needs a decision
Attaching real files to a project, uploaded straight to storage so bytes never pass through the server, with a per file switch for whether the client may see it.
**Done when:** a file uploads directly with a short lived signed URL, the confirmed size and type are read back from storage rather than trusted from the browser, an unconfirmed upload is never listed or downloadable, downloads are permission checked and time limited, and deleting removes the stored object before the row.
- [ ] Design it (spec): `/architect deliverable upload & download`

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
- **Agency timezone**: no timezone is modelled, so invoice issue dates and the overdue sweep use UTC. An invoice issued late in the evening on the west coast gets tomorrow's date. Spec 0002 has the application supply both dates, so the fix is one `organizations.timezone` column plus a helper · from spec 0002 · needs a decision
- **Postgres row level security**: a second line of defence that fails closed instead of open. Spec 0001 calls this the single biggest security upgrade available to the design. Spec 0002 leaves it unblocked (`org_id` is not null on every tenant table) and records the policy shape; what remains is applying a per request setting inside each transaction on the pooler, which feature 4 must settle first · needs a decision
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
