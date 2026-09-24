# Verify: dashboard summary · spec 0020 · updated 2026-09-24

_Steps derived from spec 0020 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [x] Sign in as agency staff with a client, an overdue invoice, an open project and a recent deliverable → visit `/dashboard` → header reads "Dashboard" with description `<agency> · Admin` (or `· Member` for a member) → AC-1
- [x] With that data → three `<h2>` sections render stacked, full width, no horizontal scroll at phone width → AC-2
- [ ] Seed 2 `overdue` invoices and 1 `sent` invoice past due, plus a `sent` not-yet-due, a `paid` and a `void` → headline reads "3 overdue invoices" → AC-3
- [ ] Same data, invoices in two currencies → one total line per currency, sorted by code, e.g. "£4,200.00 overdue" then a second line for the other currency; with zero overdue invoices, no total line renders → AC-4
- [ ] Overdue rows show invoice number, client name, total, due date, "N days overdue" (singular for 1), ordered oldest due date first then number; "View all overdue invoices" links to `/invoices?status=overdue` → AC-5
- [ ] Seed 7 open projects (mixed statuses, one `delivered`, one archived) → headline "7 open projects", 5 rows in `/projects` order (soonest due first, no due date last, then name, then id), each with status chip, due date or "No due date", `OverdueBadge` when overdue; "View all open projects" links to `/projects` → AC-6
- [ ] Seed 6 `ready` deliverables (2 within 7 days) and 1 `pending` → rows show file name, project name, client name, "Shared with client"/"Internal" chip, uploader, date added, link to the project page; headline "2 added in the last 7 days"; a deliverable added exactly 7 days ago is excluded from the count but still listed; no "View all" link → AC-7
- [ ] Empty each section individually (no overdue invoices / no open projects / no deliverables) → "Nothing overdue" (text only), "No open projects" (with "New project" → `/projects/new`), "No deliverables yet" (with a sentence, no action) → AC-8
- [ ] New agency with zero clients → only one "Add a client" empty state renders, no three sections; add one client → the three sections (with their own empty states) appear → AC-9
- [ ] Throttle the network or add an artificial delay to one section's read → header paints immediately, each section shows its own `aria-busy="true"` / `role="status"` skeleton with the right label ("Loading overdue invoices" etc.) before resolving → AC-10
- [ ] Force the overdue read to throw → that section shows `ErrorState` with "Try again" → `/dashboard`; the other two sections render normally; Sentry receives exactly one event tagged `section: overdue_invoices` → AC-11
- [ ] Sign in as agency B → agency A's overdue invoices, projects and deliverables never appear in B's counts, sums or rows; a member and an admin of the same agency see identical summaries → AC-12
- [ ] Unset `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` → `/dashboard` renders the header and the first-run state with no database read → AC-13
- [x] Issue an invoice / mark one paid / void one / move a project's status / archive a project / upload a deliverable / toggle a deliverable's visibility, then reload `/dashboard` → the relevant section reflects the change immediately (no stale cache) → AC-14
- [ ] Run axe against `/dashboard` in both themes for loaded, loading, each empty state, an errored section, and the first-run state → zero violations; heading order is one `h1` then three `h2`s; each row's link text is exactly "`<name>, <client>`"; every other detail sits beside the link as plain text → AC-15

## Commands

- [x] `corepack pnpm vitest run src/dashboard src/lib/dates.test.ts "src/app/(agency)/(gated)/dashboard/page.test.tsx"` → all green → AC-3, AC-4, AC-5, AC-9, AC-11, AC-13
- [x] `corepack pnpm vitest run src/dashboard/queries.db.test.ts` (needs `DIRECT_URL`) → tenancy isolation and archive exclusions hold against real PostgreSQL → AC-3, AC-6, AC-7, AC-9, AC-12
- [x] `corepack pnpm typecheck && corepack pnpm lint` → clean
- [ ] `corepack pnpm test:e2e` → axe clean against `/dashboard` in both themes (per `src/ui/AGENTS.md`) → AC-15 (ran: 137 passed, 3 unrelated portal-contact failures; no e2e spec actually exercises axe against an authenticated `/dashboard` yet, so this line's own claim is unproven by the suite — substituted with a manual axe run, see report)

## Acceptance-criteria coverage

- AC-1 … header agency/role · AC-2 … three sections stacked · AC-3 … overdue predicate & count · AC-4 … per-currency totals · AC-5 … overdue rows & order · AC-6 … open projects count & order · AC-7 … recent deliverables & 7-day headline · AC-8 … per-section empty states · AC-9 … first-run "Add a client" · AC-10 … streamed loading skeletons · AC-11 … per-section error isolation · AC-12 … tenant scoping · AC-13 … no-Clerk path · AC-14 … no caching, fresh on every write · AC-15 … accessibility
