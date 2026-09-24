# 0020. Dashboard summary

**Date**: 2026-09-24
**Status**: Proposed

## Summary

This spec replaces the placeholder on `/dashboard` with a real summary of the agency's week, in three sections: overdue invoices (with the total owed in each currency), open projects, and recently added deliverables. Each section shows a headline count and the top five rows, and each row links to its own record. Everything is read live from the tables features 11, 12 and 13 already built, through the tenant scoping layer (the code that makes every query see only the acting agency's rows). There is no new table and no migration. Each section loads on its own (streamed, so a slow or failing section never blanks the other two), and a brand new agency with no clients sees one "add your first client" state instead of three empty boxes.

## Requirements

**User stories**:
- As an agency staff member, I want to see which invoices are overdue and how much is owed, so I know who to chase today.
- As an agency staff member, I want to see our open projects, soonest due first, so I know what needs work without opening the projects list.
- As an agency staff member, I want to see the files most recently added across all projects, and whether each one is shared with the client, so I can catch a file that was meant to be shared but wasn't.
- As a new agency owner, I want the dashboard to tell me what to do first when there is nothing to summarise yet.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `/dashboard` opens with a page header titled "Dashboard" whose description names the acting agency and the acting role (`<agency name> · Admin` or `<agency name> · Member`, the role from the Clerk session claim as today). The `AgencyWelcome` panel no longer renders on this page.
- **AC-2**: Below the header, three sections render stacked at full width, in this order: overdue invoices, open projects, recent deliverables. Each is a labelled region with its own level two heading, a headline count, and at most 5 rows. The layout is the same at every width, with no horizontal scroll at phone width.
- **AC-3**: An invoice counts as overdue exactly when its status is `overdue`, or its status is `sent` and its `due_date` is before `todayUtc()`. `draft`, `paid` and `void` invoices never count. The headline shows the count of every matching invoice in the agency, e.g. "3 overdue invoices" (singular for 1).
- **AC-4**: When at least one invoice counts as overdue, the section also shows the total owed: the sum of `total_cents` over every matching invoice, grouped by `currency`, one line per currency ordered by currency code, each formatted with `formatMoney` (e.g. "£4,200.00 overdue"). With no overdue invoices, no total renders.
- **AC-5**: The overdue invoice rows are the first 5 matching invoices ordered by `due_date` oldest first, then by `number` ascending. Each row shows the invoice number (`INV-0007` form), the client name, the invoice total in its own currency, the due date, and "N days overdue" ("1 day overdue" for one), and links to `/invoices/[id]`. When the count is above zero, a "View all overdue invoices" link goes to `/invoices?status=overdue`.
- **AC-6**: A project counts as open exactly when `archived_at` is null and its status is not `delivered`. The headline shows the count of every open project, e.g. "7 open projects". The rows are the first 5 open projects ordered by `due_date` soonest first (no due date last), then `name`, then `id`, the same order as `/projects`. Each row shows the project name, the client name, the existing project status chip, the due date or "No due date", and the existing `OverdueBadge` when `isOverdue` holds, and links to `/projects/[id]`. When the count is above zero, a "View all open projects" link goes to `/projects`.
- **AC-7**: A deliverable counts as recent when its status is `ready` and its project's `archived_at` is null. `pending` deliverables and deliverables on archived projects never appear. The rows are the latest 5 such deliverables of any age, ordered by `created_at` newest first, then `id`. Each row shows the file name, the project name, the client name, a chip reading "Shared with client" or "Internal" from `visible_to_client`, the uploader's name (falling back to their email, as the project page does), and the date added. Each row links to its project page `/projects/[projectId]`, never to a download. The headline counts the matching deliverables whose `created_at` is strictly later than 7 × 24 hours before the request (a file added exactly 7 days ago is not counted), e.g. "4 added in the last 7 days", or "None added in the last 7 days" while older rows still show. The section has no "View all" link.
- **AC-8**: Each section shows its own empty state, using the existing `EmptyState` pattern, when it has no rows. Overdue invoices: "Nothing overdue", text only. Open projects: "No open projects" with a "New project" link to `/projects/new`. Recent deliverables: "No deliverables yet", with a sentence saying files are uploaded from a project's page and no action.
- **AC-9**: When the agency has no client rows at all (active or archived), the three sections do not render. One `EmptyState` renders in their place with an "Add a client" link to `/clients/new`. As soon as one client exists, the three sections render, each with its own empty state as needed.
- **AC-10**: The header paints without waiting on any section. Each section is its own `<Suspense>` boundary whose skeleton is `aria-busy="true"` and carries a visually hidden `role="status"` line ("Loading overdue invoices", "Loading open projects", "Loading recent deliverables"), and the three section reads run in parallel.
- **AC-11**: When one section's read fails, only that section shows the existing `ErrorState`, with a plain heading and sentence, no driver message, and a "Try again" link to `/dashboard`. The other two sections render normally. Each failure reports exactly one Sentry event through `reportException`, tagged with the section name.
- **AC-12**: Every read goes through `tenantDb(ctx)` with the context from `agencyContext()`. No count, total or row ever includes another agency's invoice, project, deliverable or client. Admins and members see identical content. The page stays inside the `(gated)` route group, so a lapsed subscription is redirected and a client contact is redirected by the proxy, both before any dashboard read runs, exactly as today.
- **AC-13**: With no Clerk publishable key configured (spec 0004, AC-22), the page renders the "Dashboard" header and the first run state from AC-9 without touching the database.
- **AC-14**: The page is rendered per request with no cache. A write made anywhere else (issuing, marking paid, voiding, a status move, archiving, an upload, a visibility toggle, the nightly sweep) shows on the next load of `/dashboard`.
- **AC-15**: Every state this page can show (loaded, loading, each section empty, each section errored, first run) meets WCAG 2.2 AA in both themes. Axe is clean. Heading order is one `h1` then the three `h2`s. Every status and the overdue marker carry words, never colour alone. Each section is a `<section aria-labelledby>` pointing at its heading's fixed id (`dashboard-overdue-heading`, `dashboard-projects-heading`, `dashboard-deliverables-heading`). Rows are a `<ul>` of `<li>`s, never a table. In each row, the link wraps only the item's name and its client name, so its accessible name is exactly those two (e.g. "INV-0007, Acme Ltd", "Website redesign, Acme Ltd", "brand-guide.pdf, Acme Ltd"). Every other detail (total, dates, days overdue, chips, uploader, project name) sits beside the link as plain text.

## Decision

**Chosen option**: Option 2: Purpose built summary reads in a new `src/dashboard/` feature folder, a count plus the top 5 per section, each section streamed in its own Suspense boundary and failing on its own.

The dashboard gets its own three small reads through `tenantDb`, which reuse the existing overdue, past due, date and money rules rather than copying them. The page is split into three independent async Server Components.

**Implementation skills**: `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.agents/skills/vercel-react-best-practices/`) · `tailwind` (`.agents/skills/tailwind/`) · `shadcn` (`.agents/skills/shadcn/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`)

## Feature design

**Data model sketch**:

No schema change, no migration, no new index. The feature reads four existing tables, all tenant scoped by `org_id`:

| Table | Relations used | Filter | Existing index that serves it |
|---|---|---|---|
| `invoices` | N:1 `clients` (name) | `status = 'overdue'` OR (`status = 'sent'` AND `due_date < today`) | `invoices_org_id_status_due_date_idx` |
| `projects` | N:1 `clients` (name) | `archived_at IS NULL` AND `status <> 'delivered'` | `projects_org_id_status_idx`, `projects_org_id_archived_at_idx` |
| `deliverables` | N:1 `projects` (name, client name), N:1 `users` (uploader) | `status = 'ready'` AND `project_id IN (active project ids)` | `deliverables_org_id_status_created_at_idx` |
| `clients` | none | any row (archived included) | primary key within `org_id` |

**State transitions**: none. The page reads the invoice and project states (specs 0012 and 0010) and changes nothing.

**API surface**:

There is no Server Action and no route handler. The surface is one page and four server side reads in `src/dashboard/queries.ts`, each taking a `StaffContext`:

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/dashboard` | GET (Server Component page) | none (agency from the session) | header, then either the first run state or the three sections | staff session, `(gated)` route group, proxy | a failed `hasAnyClient` read falls to the `(agency)` error boundary |
| `hasAnyClient(ctx)` | read | `ctx` | `boolean` | `StaffContext` | throws on a driver failure |
| `overdueInvoicesSummary(ctx, todayUtc)` | read | `ctx`, `todayUtc: string` | `{ count, totals: readonly { currency, cents }[], rows: readonly OverdueInvoiceRow[] }` (at most 5 rows) | `StaffContext` | throws on a driver failure, caught by its section |
| `openProjectsSummary(ctx, todayUtc)` | read | `ctx`, `todayUtc: string` | `{ count, rows: readonly OpenProjectRow[] }` (at most 5 rows) | `StaffContext` | same |
| `recentDeliverablesSummary(ctx, now)` | read | `ctx`, `now: Date` | `{ addedLast7Days, rows: readonly RecentDeliverableRow[] }` (at most 5 rows) | `StaffContext` | same |

The page resolves `agencyContext()`, `currentAgency()`, `todayUtc()` and `now` once, outside any section, and passes `ctx`, `todayUtc` and `now` to each section as props. A section never resolves the context itself, so the context lookup's own `redirect("/onboarding")` repair path (`src/auth/context.ts`) can never land inside a section's `catch`. Each section component (`OverdueInvoicesSection`, `OpenProjectsSection`, `RecentDeliverablesSection` in `src/dashboard/ui/`) awaits its own read inside a `try`/`catch`. The `catch` first calls `unstable_rethrow(error)` from `next/navigation`, so any Next.js control flow signal passes through untouched. For a real failure it then calls `reportException(error, { tags: { section }, fingerprint: ["dashboard_section_failed", section] })` and renders `ErrorState`. The shared frame (heading, count line, list, footer link) is one `DashboardSection` component, and the loading placeholder is one `DashboardSectionSkeleton`.

How each read works (these are the calls, not a menu):
- **`overdueInvoicesSummary`** loads every matching invoice row, with `with: { client: { columns: { name: true } } }`, through `tenantDb(ctx).findMany` (the accessor has no top level `columns` option, so the invoice rows come back whole), then hands them to a pure `summariseOverdue(rows, todayUtc)`. That function computes the count, the per currency sums and the sorted top 5 with `daysOverdue`. The overdue set is small by nature (it is debt that has not been chased), and the accessor has `count` but no `sum`, so the totals are summed in memory in integer cents.
- **`openProjectsSummary`** runs `tenantDb(ctx).count(projects, { where })` and `findMany(projects, { where, orderBy, limit: 5, with: { client } })` in parallel, then maps `overdue` through the existing `isOverdue`.
- **`recentDeliverablesSummary`** first reads the ids of the agency's active projects (`archived_at IS NULL`). With none, it returns zero rows without a second query. Otherwise it runs `count(deliverables, { where: ready AND projectId in ids AND createdAt > now - 7 days })` (strictly later, with `gt`) and `findMany(deliverables, { where: ready AND projectId in ids, orderBy: [createdAt desc, id desc], limit: 5, with: { project: { with: { client } }, uploadedBy } })` in parallel. This stays inside the accessor's typed `where` with no raw SQL subquery, matching every other feature read.
- **`hasAnyClient`** is `tenantDb(ctx).findFirst(clients) !== undefined`.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Header | agency name | `currentAgency()` (the agency's own `organizations` row), as the page does today |
| Header | role word | `agencyContext().role` (Clerk session claim), `admin` → "Admin", `member` → "Member" |
| Every read | which agency | `agencyContext()` → `StaffContext.orgId`, applied by `tenantDb` |
| Overdue and projects | "today" | `todayUtc()` from `src/lib/dates.ts`, called once per request in the page and passed to both reads |
| Overdue | whether an invoice counts | `invoices.status`, `invoices.due_date`, via `status === "overdue" \|\| isPastDue(status, dueDate, todayUtc)` (`src/invoices/status.ts`) |
| Overdue | count | the number of matching rows |
| Overdue | total per currency | the sum of `invoices.total_cents` grouped by `invoices.currency`, formatted by `formatMoney(cents, currency)` (`src/lib/money.ts`) |
| Overdue row | invoice number | `invoices.number` via `formatInvoiceNumber` (never null: every `sent` or `overdue` invoice was numbered on issue) |
| Overdue row | client name | `clients.name` through the `client` relation |
| Overdue row | total | `invoices.total_cents` and `invoices.currency` via `formatMoney` |
| Overdue row | due date | `invoices.due_date`, shown as stored (`YYYY-MM-DD`), as on `/invoices` |
| Overdue row | days overdue | a new pure `daysBetweenUtc(dueDate, todayUtc)` in `src/lib/dates.ts`, always 1 or more for a matching invoice |
| Open projects | whether a project counts | `projects.archived_at IS NULL` and `projects.status <> 'delivered'` |
| Open projects | count | `tenantDb(ctx).count` with that predicate |
| Project row | name, status, due date | `projects.name`, `projects.status` (`ProjectStatusChip`), `projects.due_date` shown as stored, as on `/projects` |
| Project row | client name | `clients.name` through the `client` relation |
| Project row | overdue marker | `isOverdue(dueDate, status, archivedAt, todayUtc)` from `src/projects/status.ts` |
| Deliverables | "the last 7 days" | `now` (one `new Date()` read in the page per request) minus 7 × 24 hours, compared strictly (`created_at >` that instant) |
| Deliverables | active project ids | `projects.id` where `archived_at IS NULL` |
| Deliverable row | file name, date added | `deliverables.name`, `deliverables.created_at` via `formatBillingDate` (as `deliverables-section.tsx` already shows it) |
| Deliverable row | project name, link target | `projects.name`, `deliverables.project_id` |
| Deliverable row | client name | `clients.name` through `project.client` |
| Deliverable row | shared or internal | `deliverables.visible_to_client` |
| Deliverable row | uploader | `users.name`, falling back to `users.email` when null, as `listDeliverables` does |
| First run | whether the agency has any client | `hasAnyClient(ctx)` |
| Invoice link | view all target | fixed: `/invoices?status=overdue` |
| Projects link | view all target | fixed: `/projects` (its default filter is already "open") |
| Section errors | Sentry tag | the section's fixed name: `overdue_invoices`, `open_projects`, `recent_deliverables` |

**Key invariants**:
- Every read goes through `tenantDb(ctx)`. Nothing in `src/dashboard/` imports `src/db/client.ts` or uses `withSystemAccess` (ESLint enforces both already).
- The overdue rule has one definition: `status === "overdue" || isPastDue(...)`. The SQL `where` and the pure `summariseOverdue` agree, and a unit test holds them together over the same fixtures.
- The dashboard's open project count equals the total `/projects` shows with no filters. Its top 5 equal that list's first 5 rows.
- The overdue count can exceed what `/invoices?status=overdue` lists, only by `sent` invoices whose due date passed since the last nightly sweep (at most one day's worth). This is accepted and known (see Consequences).
- Money is integer cents until `formatMoney`. Currencies are never added together.
- "Today" is read once per request, and "now" is read once per request. No section reads the clock itself.
- The page writes nothing and emits no analytics event.

**Security model**:
- Readers: signed in agency staff (admin or member) of the acting agency, with full access (the `(gated)` layout's subscription gate). Both roles see the same content, because both can already read every invoice, project and deliverable on their own pages.
- Client contacts never reach `/dashboard`. The proxy redirects them, as for every agency route.
- No new data leaves the server beyond what the linked pages already show. No file URL or R2 key is ever rendered (rows link to the project page, never to a download).
- No regulated data scope. Invoice totals are business records, and no payment data exists on this platform.
- Section error messages never include a driver message, a digest or an id beyond what `ErrorState` already allows.

**Configuration required**: none. No new environment variable, secret or provider setup.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: an agency with 2 stored `overdue` invoices in GBP, 1 `sent` invoice past due in EUR, 1 `sent` not yet due, 1 `paid` and 1 `void`; 7 open and 2 delivered projects; 6 ready deliverables (2 of them this week) and 1 pending. The page shows "3 overdue invoices", "£… overdue" and "€… overdue" lines, "7 open projects" with 5 rows in `/projects` order, and "2 added in the last 7 days" with the 5 newest rows. Verifies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**, **AC-7**
- Boundary: an invoice due today is not overdue, one due yesterday is "1 day overdue"; a deliverable added exactly 7 days ago falls outside the count but still lists. Verifies **AC-3**, **AC-5**, **AC-7**
- Archive rules: an archived project in `in_progress` is not counted or listed as open, and a ready deliverable on an archived project never appears. Verifies **AC-6**, **AC-7**
- Failure case: the overdue read throws, so the overdue section shows `ErrorState` with "Try again", the other two sections render, and `reportException` is called once with `section: "overdue_invoices"`. A read that throws a Next.js redirect instead is rethrown, not reported and not rendered as an error. Verifies **AC-11**
- Empty and first run: an agency with zero clients sees only the "Add a client" state; one with a client but nothing else sees three section empty states with the right copy and links. Verifies **AC-8**, **AC-9**
- Auth and tenancy (real PostgreSQL): agency B's overdue invoices, open projects and deliverables never appear in agency A's counts, sums or rows. A member and an admin of A get identical summaries. Verifies **AC-12**
- No Clerk configured: the page renders the header and first run state, and no query function is called. Verifies **AC-13**
- Accessibility: axe clean in both themes for loaded, loading, empty, errored and first run states; heading order `h1` then 3 `h2`s. Verifies **AC-15**

## Build plan

Tracer Bullet: the first task proves the whole pipe (session → tenant context → purpose built read → streamed section → link out) with one real section. Later tasks add the other two sections, then the failure and edge handling, then the proof. No migration task, because the feature touches no schema.

1. **One thread end to end.** Create `src/dashboard/` with `queries.ts` holding `openProjectsSummary`, plus `ui/dashboard-section.tsx` (heading, count line, list, footer link) and `ui/open-projects-section.tsx`. Rework `src/app/(agency)/(gated)/dashboard/page.tsx`: the header description becomes `<agency> · <role>`, the `AgencyWelcome` panel and the placeholder `EmptyState` go, `todayUtc()` is read once, and the open projects section renders inside its own `<Suspense>` with real rows, the overdue badge, the "View all open projects" link and its empty state. Satisfies **AC-1**, **AC-6**, **AC-8** (projects), **AC-12**, **AC-14**
2. **Overdue invoices.** Add `daysBetweenUtc` to `src/lib/dates.ts`, the pure `summariseOverdue` and `overdueInvoicesSummary` to `src/dashboard/queries.ts`, and `ui/overdue-invoices-section.tsx` with the per currency totals, rows, the "View all overdue invoices" link and its empty state. It renders first in the page order. Satisfies **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-8** (invoices)
3. **Recent deliverables.** Add `recentDeliverablesSummary` (the active project ids read, then the count and the rows in parallel) and `ui/recent-deliverables-section.tsx` with the shared or internal chip, uploader, date, project links, the 7 day headline and its empty state. Satisfies **AC-2**, **AC-7**, **AC-8** (deliverables)
4. **Loading and failure isolation.** Add `DashboardSectionSkeleton` (announced as loading) as each boundary's fallback, and the per section `try`/`catch` that calls `unstable_rethrow` first, then `reportException` with the section tag, and renders `ErrorState` with a "Try again" link. Confirm `ctx`, `todayUtc` and `now` reach every section as props, never resolved inside one. Satisfies **AC-10**, **AC-11**
5. **First run and no Clerk.** Add `hasAnyClient`. The page awaits it before rendering sections and shows the single "Add a client" state when false. With Clerk unconfigured, it renders that state with no read. Satisfies **AC-9**, **AC-13**
6. **Design gallery and accessibility.** Add `DashboardSection` and `DashboardSectionSkeleton` to `/design` in every state (loaded, empty, errored, loading) with axe tests in both themes. Check heading order, row link names and the chip wording. Satisfies **AC-15**
7. **Proof.** Unit tests for `summariseOverdue`, `daysBetweenUtc` and the SQL versus pure overdue agreement. Real PostgreSQL tests (`src/dashboard/queries.db.test.ts`) for the three reads, including the cross agency and archive exclusions and the boundaries above. Update `dashboard/page.test.tsx` for the new structure, the first run state, the no Clerk path and one failing section. Satisfies **AC-3** to **AC-7**, **AC-9**, **AC-11**, **AC-12**, **AC-13**

## Consequences

**Positive**:
- The first screen after sign in finally answers "what needs me today", which the scope has promised since spec 0004.
- No schema, no migration, no new provider, and no new write path. The feature cannot corrupt data.
- The overdue rule, the project overdue rule, "today" and money formatting are reused, not copied, so the dashboard can't drift from the pages it links to.
- One flaky read degrades one section, not the whole page.

**Negative / tradeoffs**:
- The overdue count can be a little ahead of `/invoices?status=overdue` for up to a day (sent invoices past due before the nightly sweep runs). A careful user may notice the mismatch after clicking "View all".
- `overdueInvoicesSummary` loads every overdue invoice to sum it in memory. That is fine at realistic agency volumes (tens, not thousands), but it has no ceiling. A sum on the accessor would be the fix if it ever measures slow.
- `recentDeliverablesSummary` passes the active project ids as an `IN` list. That is fine into the low thousands of projects, but an agency far beyond that would want a join, which needs the tenant layer to grow a new reader.
- Up to seven small queries per page load: the client check, one overdue read, a count and rows for projects, and the active project ids plus a count and rows for deliverables. There is no caching, by choice, so every visit hits the database.
- The client check runs before the three sections can start, because it decides the page's shape. The header paints first, but the three parallel reads wait one query behind it.
- Each section's count and rows are two separate queries with no shared snapshot, so a write landing between them can briefly make the headline and the rows disagree (e.g. "6 open projects" above a list reflecting 7). The next load corrects it. This is accepted, like the invoice filter gap. The runner up, one read transaction per section, would hold a pooled connection for no user visible gain.
- The agency's default currency no longer shows on the dashboard (it lived in the welcome panel). It remains on `/settings`.

**Neutral**:
- `src/dashboard/` is a new feature folder. `/sync` will want a line for it, and possibly a nested `AGENTS.md` if it grows.
- `AgencyWelcome` loses its only caller. Delete it with its test in this feature, or keep it if `/settings` wants it (a build time call).
- `formatBillingDate` lives in `src/payments/` but is used for a deliverable date, as the project page already does.

## Follow-up

- [ ] If the one day overdue mismatch confuses users, widen the `/invoices` overdue filter to include `sent` past due invoices (a change to feature 13's filter and tests), so the two agree exactly.
- [ ] Revisit `formatBillingDate`'s home (a shared date formatter in `src/lib/dates.ts`) once a third caller appears.
- [ ] When an agency timezone lands (spec 0002's deferred item), "today" and "the last 7 days" both follow `todayUtc()` and `now`, so only that function changes.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
