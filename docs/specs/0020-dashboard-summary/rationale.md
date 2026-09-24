# 0020. Dashboard summary: rationale

## Context

`/dashboard` is where every signed in agency staff member lands, and today it shows a welcome panel and a placeholder that promises "open projects, overdue invoices and recent deliverables land here as those parts of the product are built". Features 11, 12 and 13 have now built all three, so the promise can be kept. The scope row (feature 21) asks for exactly those three, each read live, each linking through to its own list, all through the tenant scoping layer, each with its own correct empty state.

Three facts in the existing code shape the problem. First, "overdue" means two things for invoices: the stored `overdue` status, which the nightly sweep (spec 0017) sets, and the derived "past due" of a `sent` invoice whose due date has passed but which the sweep has not reached yet (`isPastDue` in `src/invoices/status.ts`). The invoice list's status filter only knows the stored one. Second, deliverables have no list of their own; they live on a project's page, so "linking through to its own list" has no target for that section. Third, the existing list reads (`listProjects`, `listInvoices`) load every matching row and page in memory, which is fine for a paged list but wasteful when a summary needs a count and five rows.

The forces are the usual ones for this product: tenant isolation is load bearing (spec 0003), every surface must meet WCAG 2.2 AA including empty and error states (spec 0004), "today" is the server's UTC day from one function (spec 0012), and money is integer cents with one formatter. The build approach is Tracer Bullet and the tier is GA. Nobody has measured a performance problem, and agencies are small (tens of clients, not thousands).

## Options considered

### Option 1: Count tiles only

Three stat tiles ("3 overdue invoices", "7 open projects", "4 new files this week"), each a link to the matching list. One `count` per tile through `tenantDb`, no rows.

**Pros**:
- The smallest build: three counts and three links.
- Nothing to keep in sync with the list pages beyond the filter.

**Cons**:
- A number is not an action. Staff still click through to learn which invoice or project it is.
- The deliverables tile has nowhere to link to.
- It loses the overdue total, the single most useful number for an agency owner.

### Option 2: Purpose built summary reads, count plus top 5, streamed per section (chosen)

A new `src/dashboard/` folder with three small reads through `tenantDb` (a count and the first five rows each, plus the per currency overdue total), reusing the existing overdue, date and money rules. The page renders three independent async Server Components, each in its own `<Suspense>`, each catching its own failure.

**Pros**:
- It shows both the scale (count, total) and the next action (the top rows) on one screen.
- Its reads are sized to the summary (`limit: 5` plus a `count`) instead of loading whole lists.
- A slow or failing section never holds up or blanks the others.
- It follows the project rule that features get their own folder, and keeps the dashboard's definitions in one place.

**Cons**:
- Three new reads to test against real PostgreSQL, including the cross agency cases.
- The overdue section's definition is wider than the invoice list's filter, so the counts can differ for up to a day.
- More moving parts on the page (three boundaries, three fallbacks, three error paths) than a single await.

### Option 3: Reuse the existing list functions

Call `listProjects` and `listInvoices` with page 1 and take the first five rows and the `total`, and add a similar list function for deliverables.

**Pros**:
- No new query code for projects and invoices. The dashboard is definitionally identical to the lists.

**Cons**:
- Both functions load every matching row and slice in memory, so the dashboard pays for a full list to show five rows.
- `listInvoices` has no "overdue or past due" filter and no sum, so the overdue section would either lose the sent past due invoices or need the list function changed.
- The invoice list orders drafts first and then newest issued, not oldest due, so the rows would still need re sorting.

### Option 4: Stored counters

A `dashboard_stats` row per agency (overdue count, per currency totals, open project count) kept current by every invoice, project and deliverable write, and by the nightly sweep.

**Pros**:
- The page load is one tiny read at any scale.

**Cons**:
- Every existing write path and the sweep must update it in the same transaction, or it goes stale. This is a derived value stored with no measured need.
- A new table and migration, plus a reconcile for when it drifts.
- It still needs the row reads for the top five, so it saves little.

## Rationale

Option 2 is the one that does the job the scope row describes. It answers "what needs me today" with the actual items, not just numbers, and it does it without touching a single write path. Option 1 is simpler, but it hands the real question back to three list pages and loses the overdue total. Option 4 solves a scale problem this product does not have and would put a derived counter on every money write, exactly the stored value that goes stale. Option 3 looks like reuse, but the list functions were built for paging, not summarising. Their invoice filter and order are both wrong for "who to chase", so reusing them would mean changing a shipped feature to serve a new one.

The two definitions that needed a real call were settled with the engineer. An overdue invoice includes the `sent` past due ones, because the user already sees a past due badge on those in `/invoices`, and a dashboard that ignores them for up to a day would under report debt. The cost is a known, bounded mismatch with the "View all" filter, recorded as a follow-up rather than fixed by changing feature 13 now. Open projects use exactly the `/projects` default (not delivered, not archived) and the same order, so the dashboard's top five are the list's first five and the counts agree.

Streaming each section in its own Suspense boundary with its own catch comes from the same "design for failure" instinct as the rest of the product. A summary page is three unrelated reads, and one failing should cost one box, not the page. The deliverables read uses an id list rather than a raw SQL subquery so it stays inside the accessor's typed `where`, like every other feature read. Its cost only matters far beyond any realistic agency, and the fix at that point (a new tenant layer reader) is noted in Consequences. The first run state exists because three empty boxes on day one read as broken, while one clear "add your first client" gives a new owner their next step.

## Addendum (2026-09-24): Overview cards and an invoiced by month chart

### Context

Once the three detail sections shipped, `/dashboard` still read as a chase list rather than a picture of the agency's week: a staff member had to read three lists to get a sense of scale, and nothing on the page showed a trend. A visual reference (a consumer billing dashboard with stat tiles, a bill summary and a bill history chart) prompted a page layout overhaul toward a true dashboard feel: glanceable numbers first, then a trend, then the detail. Two decisions needed a real call, both settled with the engineer: what the four cards should show, and what the chart should plot.

### Options considered

**Cards: which four numbers**

*Option A (chosen)*: overdue total, open projects, active clients, new deliverables this week. Reuses three already computed reads plus one new trivial count.
- Pros: cheapest option; spans all three entities the original spec already summarises, plus one (clients) that no section covered.
- Cons: no revenue figure, so an owner still cannot see billed amount at a glance without reading the chart.

*Option B*: the same four, plus a fifth "paid this month" revenue card.
- Pros: closer to a finance dashboard.
- Cons: needs a new sum by paid month read that mostly duplicates the chart's own read; two near identical revenue reads on one page was judged not worth it.

**Chart: what to plot**

*Option A (chosen)*: invoiced amount issued per month, by `issue_date`, last 6 months.
- Pros: shows billing volume regardless of collection status; every agency has data to show from its first issued invoice.
- Cons: an agency that issues late or backdates invoices sees a lumpier trend than a strict "when the work happened" view would.

*Option B*: paid amount per month, by `paid_at`.
- Pros: closer to the reference image's bill history, answers "how much came in."
- Cons: an agency early in its life, or slow to mark invoices paid, would show a flat or empty chart for months, which reads as broken rather than quiet.

**Chart library**

*Option A (chosen)*: shadcn's `chart` primitive, wrapping Recharts (a React charting library).
- Pros: shadcn is already this project's component source, so this is the smallest new surface; Recharts gives axes, a legend and hover detail without hand building them, and composes with CSS variable colours, matching the token driven theme (`src/ui/AGENTS.md`).
- Cons: the first non shadcn native runtime dependency in `src/ui`, a bundle size and a maintenance surface the project did not carry before.

*Option B*: a hand rolled inline SVG line, no new dependency.
- Pros: zero new dependency, full control over markup.
- Cons: rebuilding axis ticks, a legend, hover detail and the accessible table alternative by hand is real, ongoing work for one chart, against a well trodden library that already fits the design system.

### Rationale

Reusing the already computed reads for the cards keeps the Overview row honest with the same rules the detail sections already enforce (AC-3, AC-6, AC-7), at the cost of a few extra small queries, consistent with this spec's existing "no caching by choice" stance. Issue date based invoicing volume was chosen over paid date revenue because it is available to every agency immediately, while a paid date chart would read as broken for an agency that has not yet had time to collect on its early invoices, a worse first impression than a chart that is merely quieter early on. shadcn's chart primitive is the boring choice: it composes with the token system this project already enforces rather than asking the codebase to invent chart specific theming, and Recharts is a proven, widely used library, not a new or exciting one chosen for its own sake.
