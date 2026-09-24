# Review, feat/dashboard-summary-spec, 2026-09-24

**Reviewed by**: claude-opus-5-5 (author on a different model, not recorded)
**Scope**: 24 files, branch vs main (merge base 5c1bec5)
**Verdict**: Changes requested

## Summary
The branch replaces the `/dashboard` placeholder with the three section summary from spec 0020: overdue invoices, open projects and recent deliverables. Each section streams in its own Suspense boundary and fails on its own. The code is careful and follows the spec closely. Every read goes through `tenantDb(ctx)`, nothing in `src/dashboard/` imports `src/db/client.ts` or `withSystemAccess`, and the overdue, project overdue, date and money rules are reused, not copied. I found no correctness or tenancy bug. The two Major findings are test gaps on scenarios the spec lists as critical: the redirect rethrow path, and cross agency isolation for recent deliverables. The rest are small convention and duplication points.

## Major

### 🟠 The `unstable_rethrow` path in the three section catches is untested, `src/dashboard/ui/overdue-invoices-section.tsx:37`
(also `open-projects-section.tsx:34`, `recent-deliverables-section.tsx:38`)
**Problem**: Spec 0020's critical test scenarios require that a read throwing a Next.js redirect is "rethrown, not reported and not rendered as an error". No test covers this. The section tests and `page.test.tsx` only throw a plain `Error`. Grepping `src/dashboard` and the page tests for `rethrow`, `NEXT_REDIRECT` and `redirect` finds nothing outside the three components.
**Why it matters**: If someone removes this one line or reorders it after `reportException`, every `redirect()`/`notFound()` raised under a section becomes a "could not be loaded" box and a Sentry event, and CI stays green. The spec exists to prevent this regression: it moved context resolution out of the sections so the `/onboarding` repair redirect cannot land in a catch.
**Suggested fix**: In each section test (or once in `page.test.tsx`), make the summary mock reject with a real Next.js redirect error, for example by calling `redirect("/x")` inside the mock. Assert that rendering rejects with it, that `reportException` is not called, and that no `ErrorState` renders.

### 🟠 No cross agency fixture for `recentDeliverablesSummary`, `src/dashboard/queries.db.test.ts:351`
**Problem**: The overdue and open projects DB tests each seed an org B row and assert that it is excluded. The recent deliverables test seeds only org A projects and deliverables. Spec 0020's "Auth and tenancy (real PostgreSQL)" scenario names deliverables explicitly: "agency B's ... deliverables never appear in agency A's counts, sums or rows".
**Why it matters**: This read has the most complex shape of the three: an `IN` list of project ids, then a nested `project -> client` and `uploadedBy` relation load. It is exactly where a later refactor might drop into a join or a raw subquery. Tenancy leakage is the product's load bearing risk, so an AC-12 scenario the spec requires should have a test.
**Suggested fix**: Add an org B active project with a recent `ready` deliverable, created inside the 7 day window, to the existing case. Assert it appears in neither `rows` nor `addedLast7Days`.

## Minor

### 🟡 The boundary scenarios in the spec are not tested against real SQL, `src/dashboard/queries.db.test.ts:351`
**Problem**: The spec's boundary scenario says "a deliverable added exactly 7 days ago falls outside the count but still lists". No fixture sits at `NOW - 7d` exactly, so the strict `gt` in `queries.ts:232` could become `gte` without any test failing. The "sent invoice due today is not overdue" case is covered only in the pure `summariseOverdue` test. The SQL `lt(invoices.dueDate, todayUtc)` at `queries.ts:129` is the half that actually filters, and it has no due today fixture in `queries.db.test.ts`.
**Why it matters**: Off by one boundaries are what AC-3 and AC-7 are specified around. The pure predicate and the SQL predicate are meant to be held together (spec, Key invariants), but at the boundary only one side is checked.
**Suggested fix**: Add a `ready` deliverable at `2026-09-17T12:00:00.000Z` (exactly `NOW - 7d`) and assert that it lists but is not counted. Add a `sent` invoice with `dueDate: TODAY` to the overdue DB fixture and assert that the count is unchanged.

### 🟡 The error state markup is duplicated four times, `src/dashboard/ui/overdue-invoices-section.tsx:48`
(also `open-projects-section.tsx:45`, `recent-deliverables-section.tsx:49`, `src/app/design/gallery.tsx:1579`)
**Problem**: Each section hand rolls the same `<section aria-labelledby>` + `<h2>` + `ErrorState` + "Try again" block. The gallery copies it a fourth time instead of rendering the real thing. The frame classes are also duplicated from `DashboardSection` and `DashboardSectionSkeleton`.
**Why it matters**: AC-15's heading and landmark contract is spread across four copies, and the gallery (where axe runs) can drift from what production renders.
**Suggested fix**: Add a `DashboardSectionError({ headingId, heading, title })` beside `DashboardSection` in `dashboard-section.tsx`, and use it in the three sections and the gallery.

### 🟡 Mutable locals contrary to the functional/immutable rule, `src/dashboard/queries.ts:82`
**Problem**: `summariseOverdue` builds the totals with a `for` loop that mutates a `Map`. Each section also uses `let summary` and assigns it inside `try` (`overdue-invoices-section.tsx:33`, and the same in the other two sections).
**Why it matters**: AGENTS.md asks for `const`, no in place mutation, and `reduce` where it reads well. None of this is a bug, but the new feature folder sets the pattern for later ones.
**Suggested fix**: Fold the totals with `reduce` into a readonly record, or a new `Map` per step. For the sections, put the read in a small helper that returns a `Result`-shaped `{ ok: true, summary } | { ok: false }`, so `summary` is a `const`. This also matches the project's "expected failures as values" rule.

### 🟡 `recentDeliverablesSummary` loads whole project rows just to get their ids, `src/dashboard/queries.ts:213`
**Problem**: The read pulls every column of every active project in the agency only to `.map((p) => p.id)`. The spec accepts the `IN` list, but not the extra payload.
**Why it matters**: It is a small cost now, but it grows with project count on every dashboard load, and there is no caching by design.
**Suggested fix**: If the accessor cannot select columns at the top level (the spec notes this for invoices), accept it and add a comment. Otherwise select only `id`. Also note it next to the existing `IN` list tradeoff in the spec's Consequences.

## Nits
- ⚪ `src/dashboard/queries.ts:117`: the docstring says "Every invoice this agency holds, read whole", but the read filters to overdue and past due `sent` rows. Reword it to "every matching invoice".
- ⚪ `src/dashboard/queries.ts:98-110`: the `?? ""`, `?? 0` and `?? todayUtc` fallbacks turn an impossible null into "INV-0000" or "0 days overdue" without any signal. A narrowing guard that skips the row, or a `reportException`, would make the invariant break visible instead.
- ⚪ `src/dashboard/queries.db.test.ts:449`: the test title says "with no second query", but it only asserts the return value. Either spy on the accessor's call count or drop the claim from the title.
- ⚪ `skills-lock.json`: an unrelated `security-audit` skill entry is in this feature diff. Split it into its own `chore:` commit.
- ⚪ No test shows that admin and member get identical summaries (spec AC-12 scenario). This is trivially true today because no read takes `role`, so a one line assertion would be enough.

## Strengths
- Tenancy is right by construction. Every read goes through `tenantDb(ctx)`, and `ctx` is resolved once in the page and passed as a prop. This keeps the `agencyContext()` repair redirect out of any section's catch, a subtle point the spec called out and the code honours.
- Failure isolation matches AC-11 exactly: `unstable_rethrow` first, then one `reportException` with a section tag and fingerprint, then an `ErrorState` that does not leak the driver message. `page.test.tsx` proves the other two sections still render.
- `summariseOverdue` is kept pure and separate from the read. Money stays in integer cents, currencies are never mixed, and totals are ordered by currency code. `daysBetweenUtc` parses both sides as UTC midnight, so there is no DST drift, and it is tested across a month boundary.
- The open projects ordering and predicate match `src/projects/queries.ts` (`asc(dueDate)`, name, id; default open = not delivered and not archived), so the invariant that the dashboard equals `/projects` holds.
- The DB tests run against real PostgreSQL in a rolled back transaction, with a clear note about the one connection pool deadlock.

## Test coverage
Coverage is good overall:
- Pure: `summariseOverdue` (predicate, per currency totals, ordering, the 5 row cap, days overdue) and `daysBetweenUtc` (same day, one day, month boundary, negative).
- Real DB: `hasAnyClient` (true/false), the overdue SQL with org B exclusion, open projects with archive, delivered and org B exclusion plus the null due date ordering, and deliverables with pending and archived project exclusion plus the 7 day window.
- Components: each section's empty, loaded and error states, and the shared frame and skeleton.
- Page: header role text, no Clerk path, first run, all three sections, one failing section.

Untested:
- The Next.js control flow rethrow path (Major).
- Cross agency isolation for deliverables (Major).
- The exact 7 day and due today boundaries at the SQL level (Minor).
- Admin/member parity (Nit).
