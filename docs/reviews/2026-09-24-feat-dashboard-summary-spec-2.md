# Review, feat/dashboard-summary-spec, 2026-09-24 (round 2)

**Reviewed by**: claude-opus-5-5 (author on a different model, not recorded)
**Scope**: 24 files, branch vs main (merge base 5c1bec5). Untracked screenshots and the `skills-lock.json` change are excluded as instructed.
**Verdict**: Approve with nits

## Summary
The branch replaces the `/dashboard` placeholder with the three section summary from spec 0020. This is a re-review after two Major test gaps were fixed. Both fixes are real, not cosmetic. The redirect tests use a genuine Next.js redirect error and would fail if `unstable_rethrow` were removed or moved after `reportException`. The cross agency deliverables fixture fails if tenant scoping breaks for the read. It has one blind spot, though: the two scoped queries back each other up, so a single one losing its org filter would not trip it (Minor below). Tenancy is still correct by construction. No file in `src/dashboard/` imports `src/db/client.ts` or `withSystemAccess`, and every read goes through `tenantDb(ctx)`. What remains is the prior round's Minor and Nit findings, which still apply, plus a few small new ones. No Blockers or Majors.

## Verification of the round 1 fixes

### (a) Redirect rethrow tests: adequate
`overdue-invoices-section.test.tsx:156`, `open-projects-section.test.tsx:78` (new file line), `recent-deliverables-section.test.tsx:141` (new file line)
- `redirectError()` calls the real `redirect()` from `next/navigation` without mocking it, so the thrown object carries the real `NEXT_REDIRECT` digest that `unstable_rethrow` recognises. No hand made object is involved. The suite passes (58/58 across `src/dashboard`, the page test and `dates.test.ts`), which confirms that the real `unstable_rethrow` recognises this error under Vitest's node environment.
- The tests call the component directly (`await expect(Section(...)).rejects.toBe(error)`) instead of rendering it. That is correct here: the section's own promise is what the catch controls.
- Mutation reasoning: without `unstable_rethrow`, the catch reports the error and returns the `ErrorState` JSX, so the promise resolves. Then `rejects.toBe` fails and `reportException` has been called, which also fails. If `unstable_rethrow` were moved after `reportException`, the promise would still reject, but `expect(reportException).not.toHaveBeenCalled()` would fail. Both regressions the spec cares about are caught.
- One small gap: the assertions show the redirect propagates. They do not show that no `ErrorState` markup is produced. That follows from the rejection, since the component never returns, so it is not a real gap.

### (b) Cross agency deliverables fixture: adequate for the spec scenario, with one blind spot
`src/dashboard/queries.db.test.ts:311-397`
- The org B project and its `ready` deliverable (`createdAt` 2026-09-23, inside the window and newest in the fixture) are a meaningful fixture. If it leaked, it would sort first in `rows` and raise `addedLast7Days` to 2, so both exact assertions (`toEqual([...])` and `toBe(1)`) would fail. A broken `tenantDb` scope, or a refactor that swaps the two step read for an unscoped join, would be caught.
- The blind spot is logged as a Minor below. The read has two independently scoped layers, the active project id list and the deliverables query. The only org B deliverable sits on an org B project, so removing the org filter from just one layer still leaves the row excluded by the other. The test proves the result is isolated. It does not prove each layer isolates on its own.

## Minor

### 🟡 The cross agency fixture cannot detect a single layer scoping loss, `src/dashboard/queries.db.test.ts:385`
**Problem**: The org B deliverable is on the org B project. `recentDeliverablesSummary` filters it out twice: the project id list is org scoped (`queries.ts:213`), and the deliverables `count`/`findMany` are org scoped (`accessor.ts` `scope()`). If either filter were lost on its own, the row would still be excluded and the test would stay green. The schema allows a stronger fixture: `deliverables.project_id` references `projects.id` only, with no composite `(org_id, project_id)` FK (`src/db/schema/projects.ts:80`).
**Why it matters**: The spec names the `IN` list as the part most likely to be refactored (Consequences). A later change that fetches deliverables by project id through a less strictly scoped path would keep passing, as long as the project list stayed scoped.
**Suggested fix**: Add one more row, an `orgId: orgB` deliverable whose `projectId` is org A's `active` project (ready, inside the window). Assert it appears in neither `rows` nor the count. That row can only be excluded by the deliverables query's own org predicate, so each layer is then pinned on its own.

### 🟡 Spec boundary scenarios are still not tested against real SQL, `src/dashboard/queries.db.test.ts:333-397`
**Problem**: This is carried over and still applies. No deliverable sits at exactly `NOW - 7d`, so `gt` in `queries.ts:232` could become `gte` without any test failing. No `sent` invoice due exactly `TODAY` is in the overdue DB fixture, so `lt` in `queries.ts:129` could become `lte` and the SQL would disagree with `summariseOverdue`, silently, until the pure filter hid it. `summariseOverdue` refilters, so the count would be masked, but the SQL/pure agreement the spec requires would not be checked at the boundary.
**Why it matters**: AC-3 and AC-7 are specified around these exact edges, and the spec's "Boundary" critical scenario lists both.
**Suggested fix**: Add a `ready` deliverable at `2026-09-17T12:00:00.000Z` (exactly `NOW - 7d`) and assert that it lists but is not counted. Add a `sent` invoice with `dueDate: TODAY` to the overdue fixture and assert the count is unchanged.

### 🟡 Error state markup is duplicated four times, `src/dashboard/ui/overdue-invoices-section.tsx:46-69`
(also `open-projects-section.tsx:43-66`, `recent-deliverables-section.tsx:47-70`, `src/app/design/gallery.tsx` "errored" block)
**Problem**: This is carried over. Each section hand rolls the same `<section aria-labelledby>`, `<h2>`, `ErrorState` and "Try again" block, and so does the gallery. The frame classes duplicate `DashboardSection`/`DashboardSectionSkeleton` a fifth and sixth time.
**Why it matters**: AC-15's landmark and heading contract lives in four copies. The gallery, where axe runs, can drift from production.
**Suggested fix**: Add `DashboardSectionError({ headingId, heading, title })` to `dashboard-section.tsx`, use it in all three sections and the gallery, and add it to `dashboard-section.test.tsx`.

### 🟡 Mutable locals against the functional/immutable rule, `src/dashboard/queries.ts:82-88`
**Problem**: This is carried over. `summariseOverdue` fills a `Map` in a `for` loop, and each section uses `let summary` assigned inside `try` (`overdue-invoices-section.tsx:33`, `open-projects-section.tsx:30`, `recent-deliverables-section.tsx:34`).
**Why it matters**: AGENTS.md asks for `const`, no in place mutation, and `reduce` where it reads well. It is not a bug, but this new feature folder sets the template for later ones.
**Suggested fix**: Fold the totals with `reduce`. Wrap each read in a small helper that returns `{ ok: true, summary } | { ok: false }`, a Result shape consistent with the project's "expected failures as values" rule. `unstable_rethrow` stays inside the helper's catch.

### 🟡 `recentDeliverablesSummary` loads whole project rows to get their ids, `src/dashboard/queries.ts:213-217`
**Problem**: This is carried over. Every column of every active project is read, then only `.map((p) => p.id)` is used. The accessor has no top level `columns` option (the same limit the overdue read documents), and nothing here says so.
**Why it matters**: The cost is small now, but it grows with project count on every uncached dashboard load.
**Suggested fix**: If the accessor cannot project columns, add a one line comment like the one on `overdueInvoicesSummary`, and a note in the spec's Consequences next to the `IN` list tradeoff.

## Nits
- ⚪ `src/dashboard/queries.ts:117`: the docstring says "Every invoice this agency holds, read whole", but the query filters to overdue and past due `sent`. Reword it to "every matching invoice".
- ⚪ `src/dashboard/queries.ts:98-110`: the `?? ""`, `?? 0` and `?? todayUtc` fallbacks turn an impossible null into "INV-0000" or "0 days overdue" without any signal. A guard that drops the row, or a `reportException`, would make an invariant break visible.
- ⚪ `src/dashboard/queries.db.test.ts:416`: the title claims "with no second query", but only the return value is asserted. Either spy on the accessor or drop the claim.
- ⚪ No test asserts that admin and member get identical summaries (spec AC-12 scenario). It is trivially true today because no read takes `role`, so one assertion in `queries.db.test.ts` with `role: "member"` would lock it.
- ⚪ `src/app/(agency)/(gated)/dashboard/page.tsx:44`: `const [ctx, agency] = [await agencyContext(), await currentAgency()]` reads like a parallel fetch but runs sequentially. Either use two plain `const`s, or use `Promise.all` if the two are independent (keep them sequential if `currentAgency` relies on the context's repair redirect running first, and say so in a comment).
- ⚪ `src/app/(agency)/(gated)/dashboard/page.tsx:87-88`: `todayUtc()` and `new Date()` are two separate clock reads. They could straddle UTC midnight. Deriving `today` from `now` (e.g. `now.toISOString().slice(0, 10)`) keeps the spec's "read once per request" invariant literally true.

## Strengths
- The redirect tests are well built. They use the real `redirect()` instead of a fabricated digest object, and they assert on the component's own promise, so they test the actual `unstable_rethrow` contract, not a mock of it.
- Tenancy is right by construction. Every read goes through `tenantDb(ctx)`, and `ctx` is resolved once in the page and passed down as a prop. So the `/onboarding` repair redirect can never land inside a section's catch, exactly as the spec designed. Nothing in `src/dashboard/` touches `src/db/client.ts` or `withSystemAccess`.
- Failure isolation matches AC-11. `unstable_rethrow` runs first, then one tagged, fingerprinted `reportException`, then an `ErrorState` that never shows the driver message. `page.test.tsx` shows the other two sections still render.
- `summariseOverdue` is pure, money stays in integer cents per currency, totals are ordered by code, and `daysBetweenUtc` works at UTC midnight, with no DST drift.
- The DB suite runs against real PostgreSQL in rolled back transactions, with org B exclusion fixtures now in all three section reads.

## Test coverage
Covered:
- Pure: `summariseOverdue` (predicate, draft/paid/void exclusion, the due today boundary, per currency totals and ordering, the 5 row cap, days overdue) and `daysBetweenUtc` (same day, one day, month boundary, negative).
- Real DB: `hasAnyClient` (true/false), overdue SQL with org B exclusion, open projects with archived, delivered and org B exclusion and null due date ordering, and recent deliverables with pending, archived project and now org B exclusion plus the 7 day window. Also the no active project short circuit.
- Components: each section's empty, loaded, error and redirect rethrow states, plus the shared frame and skeleton.
- Page: header agency and role (admin and member), the no Clerk path with no reads, first run, all three sections, one failing section.

Untested or weakly tested:
- Each deliverables scoping layer on its own (Minor).
- The exact `NOW - 7d` and "due today" boundaries at the SQL level (Minor).
- Admin/member summary parity at the query level (Nit).
- Axe against an authenticated `/dashboard` in e2e. `verify.md` records this as covered by a manual run instead. It is outside this review's code scope, but still open.
