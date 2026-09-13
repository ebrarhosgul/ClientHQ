# Review, feat/projects, 2026-09-13

**Reviewed by**: Claude Opus 5 (author on a different model, prior session)
**Scope**: 57 files, branch vs `main` (merge base `dc34816`), committed + uncommitted + untracked
**Verdict**: Blocked

## Summary

Spec 0010 lands well. The workflow rule genuinely lives in one pure module that both the detail page and the Server Action read, the compare-and-set extension to the tenant layer is the narrowest change that could work, and tenant isolation is not weakened anywhere — the new `options.where` is ANDed into the same predicate as the org and id scope, and there is a real-database test proving it cannot reach another agency's row. Test coverage is above this repo's usual bar.

The blocker is elsewhere: the list page's own filter bar submits `client=` (empty) whenever "All clients" is selected, and `listProjects` treats an empty string as an unresolvable client and returns zero rows without touching the database. Pressing "Apply filters" on `/projects` therefore empties the list. `listClients` (spec 0006) avoids exactly this with a truthiness check; the projects version regressed to an `!== undefined` check. One Major follows from the same URL shape, plus a handful of minors and nits.

## Blockers

### 🔴 An empty `client` filter param empties the whole project list, `src/projects/queries.ts:128`

**Problem**: `listProjects` narrows the client filter with

```ts
if (clientParam !== undefined) {
  const parsed = clientIdSchema.safeParse(clientParam);
  if (!parsed.success) {
    return NO_RESULTS;
  }
  ...
}
```

`clientIdSchema` is `z.uuid()`, so `""` fails to parse and the function short-circuits to `NO_RESULTS`. `""` is exactly what arrives: `ProjectsFilterBar` renders a plain GET form whose client control is `<select name="client">` with `<option value="">All clients</option>` (`src/projects/ui/projects-filter-bar.tsx:108-121`), so submitting it with no client chosen navigates to `/projects?status=open&client=`, and Next.js hands `searchParams.client` back as the empty string, not `undefined`.

**Why it matters**: "Apply filters" is the primary control on `/projects`. Using it without picking a client — the default, and the only way to change the status filter — silently returns an empty list on an agency that has projects. It fails AC-4 (the status filter lives in the URL and the list shows the agency's projects) and AC-5 (only an *unresolvable* client shows an empty list). It also degrades quietly: no error, no log, just a list that looks empty. The sibling read does it correctly — `listClients` uses `trimmed ? ilike(...) : undefined` (`src/clients/queries.ts:61-66`) — so this is a regression against an existing, working pattern rather than a novel hazard.

**Suggested fix**: Treat a blank `client` param as "no filter" rather than "unresolvable", the way `listClients` treats a blank `search`: trim the param and fall through to no client predicate when it is empty, reserving the `NO_RESULTS` path for a non-empty value that is not a uuid. Alternatively normalise blank search params to `undefined` once in `ProjectsPage`'s `firstParam` — but do it in `listProjects` too, since it is a public read that page code could call with raw params again later. Then add the regression test called out in the Minor below.

## Major

### 🟠 The default empty state disappears after any filter submit, and its copy points at a control that does not exist, `src/app/(agency)/(gated)/projects/page.tsx:129`

**Problem**: `const hasFilter = Boolean(clientParam) || archived || Boolean(statusParam);` — but `ProjectsFilterBar`'s status `<select>` always has a value, so every submit of that form puts `status=open` in the URL even when the person changed nothing. From then on `hasFilter` is permanently true and the page shows the filtered empty state ("No projects match these filters", with the New project call to action stripped out, `page.tsx:154-175`) instead of the onboarding one. A brand-new agency that touches the filter bar loses the only prompt telling them how to create their first project.

The filtered copy then reads "Try a different filter, or clear them to see the full list", and there is no control in `ProjectsFilterBar` that clears filters — no "All statuses"-plus-"All clients" reset, no clear link. The only way back is to hand-edit the URL or use the Active/Archived toggle links, which preserve `statusParam`.

**Why it matters**: AC-17 puts the empty state under the WCAG/quality bar explicitly, and an empty state whose instruction cannot be followed is a dead end for the person reading it. Combined with the blocker above, the realistic first-run sequence is: open `/projects`, press Apply filters, get an empty list with no projects, no New project button, and an instruction to clear filters that nothing on the page can do.

**Suggested fix**: Two parts. Derive `hasFilter` from whether the *effective* filter differs from the default (status is not the default for this archived mode, a client is actually selected, or archived is on) rather than from mere param presence. And give the filter bar a real reset — a "Clear filters" link to `/projects` shown when `hasFilter` is true is enough, and it also makes the empty-state copy true.

## Minor

### 🟡 `countActiveProjects` fetches every row to return a number, `src/projects/queries.ts:224-233`

**Problem**: It calls `findMany` with no column projection and returns `rows.length`. This runs on every `/clients/[id]` render, purely to fill in a sentence in a confirm dialog that AC-14 describes as informational and never a gate.

**Why it matters**: It pulls full project rows (description included, up to 5,000 characters each) over the pooled connection for a count. Small today, but it is on the load path of a page that already runs three other reads, and the cost grows with a client's project history rather than staying flat.

**Suggested fix**: Use a `count(*)` through the tenant layer if the accessor exposes one, or at minimum project to a single column. If the accessor has no count surface, that is a reasonable small addition to `src/db/tenant/accessor.ts` alongside the `update` option this spec already added.

### 🟡 A projects read failure on the client page escapes the containment `ProjectsSection` was built for, `src/app/(agency)/(gated)/clients/[id]/page.tsx:69-71`

**Problem**: `ProjectsSection` goes to real trouble to contain its own read failure — `loadProjects` catches, logs, and renders a local error state so "the rest of this client record is still worth showing" (`src/projects/ui/projects-section.tsx:122-148`). But the page itself calls `countActiveProjects` unguarded, immediately after resolving the client. If the `projects` table read fails, that unguarded call throws first and the whole client page falls to `clients/[id]/error.tsx`, so the contained section never gets a chance to render.

**Why it matters**: The two reads hit the same table, so the failure mode the section guards against is precisely the one that will also trip the count. The containment is therefore mostly decorative: the page blanks either way. Not data loss, and the error boundary does exist, so this is a resilience gap rather than a break.

**Suggested fix**: Give `countActiveProjects` the same treatment as the section's read — catch, fall back to `0` (the dialog then shows the existing copy unchanged, which is the correct degradation for informational copy), and let `TenantResolutionError` propagate as `loadProjects` already does. Or move the count inside `ProjectsSection`/`ArchiveClientButton`'s own boundary.

### 🟡 The compare-and-set test asserts a condition exists, not what it says, `src/projects/transition-project.test.ts:104-109`

**Problem**:

```ts
expect(state.update).toHaveBeenCalledWith(
  expect.anything(), PROJECT_ID, { status: "in_progress" }, { where: expect.anything() },
);
```

`expect.anything()` passes for any non-null condition. Swapping `eq(projects.status, input.from)` for `input.to`, or dropping `isNull(projects.archivedAt)`, keeps this test green.

**Why it matters**: The compare-and-set is the one property in this feature that cannot be recovered from if it is wrong — a stale move lands and a project skips a stage or leaves `delivered`. The database test in `tenancy.db.test.ts` proves the *accessor* honours a condition, and this test is the only thing asserting that `transitionProject` builds the right one; it does not. Note the db test is also `describe.skipIf(!url)`, so in an environment without `DIRECT_URL` neither check runs.

**Suggested fix**: Render the passed `where` to SQL and compare it against `and(eq(projects.status, "planning"), isNull(projects.archivedAt))`, the way `accessor.test.ts` and `queries.test.ts` already do with `PgDialect().sqlToQuery`. The helper is a few lines and already written twice in this diff.

### 🟡 No test exercises the filter bar's submitted URL against the page, anywhere

**Problem**: `projects-filter-bar.test.tsx` tests the component's props and the two toggle links thoroughly, and `page.test.tsx` tests the page against hand-written `searchParams` objects. Nothing connects the two: no test asserts what the GET form actually puts in the URL, and no test feeds that shape back into `ProjectsPage` or `listProjects`.

**Why it matters**: That seam is exactly where the blocker lives, and both suites are green with the bug present. `e2e/projects.spec.ts` only covers the signed-out shape, so it cannot catch it either.

**Suggested fix**: A `listProjects` case for `clientParam: ""` asserting the database *is* queried with no client predicate, plus a `ProjectsPage` case for `{ status: "open", client: "" }` asserting the default (not filtered) empty state. Both are cheap and pin the blocker's fix.

### 🟡 The client page's archived link drops the `status=all` the spec specifies, `src/projects/ui/projects-section.tsx:74`

**Problem**: The link is `/projects?client=${client.id}&archived=true`; spec 0010's Value sourcing table gives the target as `/projects?client=<id>&archived=true&status=all`.

**Why it matters**: Behaviour is identical today only because `statusPredicate` falls back to "every status" when `archived` is true and no status param is given (`queries.ts:104`). The link is now coupled to that fallback: if the archived default ever changes to `open`, this link silently starts hiding delivered projects, which is the opposite of what "View archived" promises. Low severity, but it is a divergence from the spec with no reason recorded.

**Suggested fix**: Add `&status=all` to match the spec, or record in the spec that the link deliberately relies on the default.

## Nits

- ⚪ `src/app/(agency)/(gated)/projects/[id]/page.tsx:115-121`, `ProjectStatusActions` is rendered only inside `!archived` and is also handed `archived={archived}`, which is therefore always `false` at that call site. Either drop the guard and let `nextStatuses` return `[]`, or drop the prop; carrying both invites the two to disagree.
- ⚪ `src/app/design/gallery.tsx:497-510`, the move buttons are hardcoded labels. The whole point of `src/projects/status.ts` is that the buttons and the allowed moves cannot drift; the gallery opts out of that by retyping "Start work" / "Send to review" / "Mark delivered" / "Reopen". Mapping `PROJECT_STATUSES` through `nextStatuses` would make the gallery self-updating.
- ⚪ `src/app/design/gallery.tsx:516`, `aria-label={scoped("project-client-picker")}` gives the select an accessible name of `light-project-client-picker`. Everywhere else in this file `scoped()` feeds `id` / `name` / `htmlFor` and the visible name comes from a `<Label>`. Axe will not flag it (it has *a* name), but a screen reader reads a slug.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:65` and `new/page.tsx:15`, `firstParam` is defined identically in both files; `NO_RESULTS` is defined identically in `page.tsx:69` and `queries.ts:54`. One shared definition each.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:93-127`, `listProjects`, `listClientOptions` and `getClient` are awaited in sequence. `agencyContext()` is `cache()`d so the context itself is free, but the three queries are three sequential round trips that `Promise.all` would collapse into one wait.
- ⚪ `src/projects/ui/projects-filter-bar.tsx:138,148`, `aria-current="true"` on the Active/Archived links. `aria-current="page"` is the more precise token for "this is the view you are on" and is what assistive tech announces most usefully.
- ⚪ New signatures use `null` fairly freely (`isOverdue(dueDate: string | null, ..., archivedAt: Date | null, ...)`, `RestoredProject = { archivedAt: null }`) against AGENTS.md's "avoid `null`, prefer explicit `undefined`". These mirror Drizzle row shapes and spec 0010's own API table, and match what `src/clients` already does, so this is consistency rather than a violation — noting it once so the rule's boundary stays deliberate.

## Strengths

- **The tenant layer change is exactly the right size and is properly fenced.** `scope()` became a rest-arg function and the caller's condition is spread into the same `and(org, ...extra)` as the org and id predicates (`src/db/tenant/accessor.ts:187-214`), so a caller's condition can only ever narrow. The `UpdateOptions` doc comment says so, the unit test asserts the rendered SQL is one flat `(org_id = $1 and id = $2 and status = $3)`, and `tenancy.db.test.ts:542` proves against a real database that agency A cannot reach agency B's project through it. No new ESLint exemption, no new raw-handle import, no widening of `withSystemAccess`. This is the part of the diff that most needed to be right and it is.
- **The workflow rule really is single-source.** `MOVES` is a `Readonly<Record<ProjectStatus, ...>>`, so exhaustiveness over the status enum comes from the type rather than a switch that could rot, and `status.test.ts` walks all sixteen ordered pairs against an explicit allow-set rather than re-asserting the implementation.
- **`createProject` is closed by construction, not by checking.** The input schema has no `status` field at all, and there is a test that smuggles `status: "delivered"` into the raw input and asserts it is dropped — that is the right way to prove AC-1's "status is never chosen at creation".
- **Foreign-id indistinguishability is held everywhere.** `getProject`, `transitionProject`'s follow-up read, and both archive actions all collapse missing / foreign / non-uuid into the same `undefined` or `not_found` with an empty message. A prober learns nothing.
- **The date validation is genuinely correct**, not just regex-shaped: `isRealCalendarDay` round-trips through `Date.UTC` and compares back, so `2026-02-30` is refused, and the two-digit-year trap (`Date.UTC(26, ...)` → 1926) falls out correctly too.
- **`isOverdue` takes `todayUtc` as a parameter** rather than reading the clock, which makes the boundary cases testable and hands feature 18 a reusable rule — and the test covers the boundary properly (due today is not overdue, due yesterday is).

## Test coverage

Strong, and above this repo's usual bar. Every new module has a test file beside it: the pure status module walks all sixteen status pairs plus the overdue boundary; the Zod schemas cover blank, over-cap, impossible-date and smuggled-field cases; each Server Action has its own file with the happy path, the refusals, and the idempotency or conflict branches; every UI component has an axe pass in both themes; and the route pages cover the admin/member split (AC-12), the archived shape (AC-10, AC-11), the overdue badge, and the no-Clerk-credentials shape. `e2e/projects.spec.ts` adds the signed-out route coverage that was missing.

Two real gaps, both already listed above:

1. **Nothing tests the filter bar's submitted URL against the page or the query.** The component tests stop at its props and the toggle links; the page tests start from hand-written `searchParams`. The blocker lives precisely in that seam and both suites pass with it present. A `listProjects` case for `clientParam: ""` and a `ProjectsPage` case for `{ status: "open", client: "" }` would close it.
2. **The compare-and-set condition is asserted as `expect.anything()`.** `transition-project.test.ts` is the only test that checks what condition `transitionProject` builds, and it checks only that one exists. Render it and compare, as the neighbouring test files already do — this is the feature's one unrecoverable invariant.

Smaller notes: `listProjects` mocks `findMany` wholesale, so the `with: { client: ... }` relation join is never exercised against a real schema (the flattening is tested, the join is not); and `tenancy.db.test.ts` is `skipIf(!url)`, so the strongest isolation proofs only run where `DIRECT_URL` is set — worth confirming CI's second job actually sets it for this file.
