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

## Addendum: Overview cards and invoiced by month chart (updated 2026-09-24)

_Steps derived from the addendum's acceptance criteria, AC-16 to AC-25._

### UI / manual

- [ ] Visit `/dashboard` with overdue invoices, open projects, active and archived clients, and deliverables added in the last 7 days → an "Overview" section renders immediately below the header, before "Invoiced by month", with 4 stat cards in this order: Overdue, Open projects, Active clients, New deliverables, each a `<dt>`/`<dd>` pair in a `<dl>` → AC-16
- [ ] The Overdue card reads "N overdue" with one line per currency (no "overdue" suffix, e.g. "£4,200.00"), and its number and totals exactly match the overdue invoices detail section below it → AC-17
- [ ] The Open projects card reads "N open", matching the open projects detail section's own count → AC-18
- [ ] The Active clients card reads the count of non-archived clients; an agency whose only clients are all archived still reaches this section (AC-9 only checks for any client) and shows "0 active" with no error → AC-19
- [ ] The New deliverables card reads "N added" with "in the last 7 days" underneath, matching the recent deliverables section's `addedLast7Days` → AC-20
- [ ] Resize the viewport: one card per row below 640px, two per row from 640px, four per row from 1024px; no horizontal scroll at any width → AC-16
- [ ] Below Overview, "Invoiced by month" renders a line chart: one line per currency with at least one `sent`/`overdue`/`paid` invoice in the trailing 6 UTC calendar months, month axis labelled like "Apr 2026", coloured `--chart-1` through `--chart-4` in currency-code order; a 5th+ currency repeats the palette with a dashed stroke → AC-21
- [ ] Hover or focus a point on the chart → a tooltip states the month, the currency code and the total as text (not colour alone) → AC-21
- [ ] Inspect the accessibility tree (or a screen reader) around the chart → a visually hidden table lists the same 6 months by the same currencies, each cell `formatMoney`-formatted or "—" when nothing was invoiced that month; the visual chart's SVG is `aria-hidden="true"` and carries no focusable descendant → AC-22
- [ ] An agency with no invoice matching the AC-21 rule anywhere in the 6 month window → the chart section shows "No invoices in the last 6 months" instead of an empty or zeroed chart → AC-23
- [ ] Throttle the network → the header, the three detail sections, Overview and the chart each paint independently; Overview's fallback is a card-shaped skeleton with a hidden "Loading overview" status line (not the list-shaped `DashboardSectionSkeleton`); the chart's fallback announces "Loading invoiced by month" → AC-24
- [ ] Force `activeClientsCount` to throw → the whole Overview card row shows "Overview could not be loaded"; the chart and all three detail sections render normally; exactly one Sentry event, tagged `overview` → AC-24
- [ ] Force `overdueInvoicesSummary` (the promise Overview and the detail section share) to throw → both the Overview overdue card and the overdue invoices detail section show their own `ErrorState`; the other 3 cards and other 2 detail sections render normally; exactly one Sentry event, tagged `overdue_invoices` (not two) → AC-24
- [ ] Force `invoicedTrend` to throw → only the chart section shows "Invoiced by month could not be loaded"; the rest of the page renders normally; exactly one Sentry event, tagged `invoiced_trend` → AC-24
- [ ] Sign in as agency B → agency A's active client count and invoiced totals never appear in B's Overview cards or chart → AC-25
- [ ] Run axe against `/dashboard` in both themes with Overview and the chart present (loaded, loading, errored) → zero violations; heading order is one `h1` then five `h2`s in this order: Overview, Invoiced by month, Overdue invoices, Open projects, Recent deliverables; the chart's legend and its `sr-only` table both carry the currency code as text → AC-15, AC-22

### Commands

- [x] `corepack pnpm vitest run src/dashboard src/lib/dates.test.ts src/ui/contrast.test.ts src/ui/token-discipline.test.ts "src/app/(agency)/(gated)/dashboard/page.test.tsx"` → all green → AC-16 to AC-25
- [x] `corepack pnpm vitest run src/dashboard/queries.db.test.ts` (needs `DIRECT_URL`) → `activeClientsCount` and `invoicedTrend` isolation and the month boundary hold against real PostgreSQL → AC-19, AC-21, AC-25
- [x] `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check` → clean
- [ ] `corepack pnpm test:e2e` → axe clean against `/dashboard` with Overview and the chart present, in both themes → AC-15, AC-22 (not yet run for the addendum; the existing e2e dashboard axe gap noted above still applies)

### Acceptance-criteria coverage

- AC-16 … Overview section & 4 cards · AC-17 … overdue card · AC-18 … open projects card · AC-19 … active clients card, reachable at 0 · AC-20 … new deliverables card · AC-21 … chart lines, palette, tooltip · AC-22 … `sr-only` table, `aria-hidden` chart · AC-23 … chart empty state · AC-24 … streaming & failure isolation, including the shared-promise reporting split · AC-25 … tenant scoping on the two new reads
