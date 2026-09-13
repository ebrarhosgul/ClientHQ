# Review, feat/projects, 2026-09-13

**Reviewed by**: Claude Opus 5 (1M context) (author on Claude Opus 5 / Claude Sonnet 5)
**Scope**: 56 files, branch vs `main` (merge base `dc34816`), all committed, working tree clean
**Verdict**: Changes requested

## Summary

Spec 0010 lands in good shape. The workflow rule genuinely lives in one pure module that both the detail page and the Server Action read, the compare-and-set extension to the tenant layer is the narrowest change that could work and is fenced correctly, and nothing here weakens tenant isolation. `pnpm test` (144 files, 2359 tests), `typecheck`, `lint` and `format:check` are all green.

This is a re-review after `477abdf`, which claimed to resolve the prior session's findings. The prior **blocker** (a blank `client=` param emptying the list) and the prior **Major** (the default empty state disappearing after any filter submit, with no way to clear filters) are both genuinely fixed, with regression tests that pin them. Three of the prior minors are untouched, and one of them — the compare-and-set test asserting `expect.anything()` — is the single unrecoverable invariant in this feature and is the reason for the Major below. `477abdf` also introduced one new spec divergence: it *removed* `&status=all` from the client page's archived link, so the code now contradicts both `index.md`'s Value sourcing table and `verify.md`'s AC-13 step.

## Status of the prior review's findings

| Prior finding | Status |
|---|---|
| 🔴 Blank `client` param empties the list (`queries.ts`) | **Resolved.** `listProjects` now trims and falls through to no predicate when blank (`src/projects/queries.ts:129-139`); `queries.test.ts:256` asserts the database *is* queried with no client predicate for `clientParam: ""`. |
| 🟠 Default empty state lost after any filter submit; copy points at a control that does not exist | **Resolved.** `hasFilter` now compares `statusParam` against the effective default for the view (`src/app/(agency)/(gated)/projects/page.tsx:134-137`), and the filtered empty state gained a real `Clear filters` link to `/projects` (`page.tsx:174-178`). Two page tests pin both halves. |
| 🟡 `countActiveProjects` fetches every row to return a number | **Unresolved.** Still `findMany` with no projection (`src/projects/queries.ts:231-235`). |
| 🟡 A projects read failure on the client page escapes `ProjectsSection`'s containment | **Unresolved.** `src/app/(agency)/(gated)/clients/[id]/page.tsx:69-71` still calls `countActiveProjects` unguarded, ahead of the section that catches. |
| 🟡 Compare-and-set test asserts a condition exists, not what it says | **Unresolved**, despite `477abdf`'s message ("tightens loose query assertions to compare rendered SQL" — it tightened `queries.test.ts` and `clients/queries.test.ts`, not this one). Escalated to Major below. |
| 🟡 No test connecting the filter bar's URL shape to the page | **Resolved in substance.** `page.test.tsx` now covers `{ status: "open", client: "" }` and the archived-default shape; `queries.test.ts` covers `clientParam: ""`. Still nothing asserts the GET form's own serialised URL, but the seam the blocker lived in is now pinned from both sides. |
| 🟡 Archived link drops `status=all` | **Regressed further** — see Minor below. |
| ⚪ All six nits | **Unresolved** (all still present; re-listed in Nits). |

## Major

### 🟠 The compare-and-set condition is still asserted as `expect.anything()`, and nothing else covers it, `src/projects/transition-project.test.ts:104-109`

**Problem**: The test is named "passes the from status and archived_at is null as the compare and set condition" and then asserts:

```ts
expect(state.update).toHaveBeenCalledWith(
  expect.anything(), PROJECT_ID, { status: "in_progress" }, { where: expect.anything() },
);
```

`expect.anything()` passes for any non-null value. Every other test in the file that exercises a miss (`transition-project.test.ts:135-193`) mocks `state.update` to resolve `undefined` and then asserts the *message*, so none of them reach the condition either. The result is that `transitionProject` could build `and(eq(projects.status, input.to), isNull(projects.archivedAt))`, or drop `isNull(projects.archivedAt)` entirely, and all 10 tests in the file stay green.

**Why it matters**: Dropping `isNull(projects.archivedAt)` is the dangerous mutation. AC-10 says an archived project's status cannot change and "a move requested directly is refused with `conflict`". The only server-side enforcement of that is this one clause — the detail page's `!archived` guard is client-visible UI, not a gate. With the clause gone, a direct `transitionProject` call against an archived project would succeed silently, and nothing in the suite would notice. `tenancy.db.test.ts` proves the *accessor* honours whatever condition it is handed, not that `transitionProject` hands it the right one, and it is `describe.skipIf(!url)` on top of that. This is the one property in the feature that cannot be recovered from after the fact, and it is the only load-bearing assertion in the diff that asserts nothing.

**Suggested fix**: Render the passed `where` with `PgDialect().sqlToQuery` and compare it against `and(eq(projects.status, "planning"), isNull(projects.archivedAt))`. The helper is already written twice in this same diff (`src/db/tenant/accessor.test.ts:48-56`, `src/projects/queries.test.ts:46-56`) — lift or copy either. While there, add one case asserting the archived clause specifically, so a future edit that drops it fails loudly.

## Minor

### 🟡 `477abdf` removed the `status=all` the spec and the verify checklist both require, `src/projects/ui/projects-section.tsx:74`

**Problem**: The commit that was meant to resolve review findings changed the archived link from `/projects?client=${client.id}&archived=true&status=all` to `/projects?client=${client.id}&archived=true`. Spec 0010's Value sourcing table gives the target as `/projects?client=<id>&archived=true&status=all`, and `docs/specs/0010-projects/verify.md`'s AC-13 step names that exact URL as the thing to check.

**Why it matters**: Behaviour is identical *today* only because `statusPredicate` falls back to "every status" when `archived` is true and no status param is given (`queries.ts:104`). The link is now silently coupled to that fallback: if the archived default ever changes to `open`, "View archived" starts hiding delivered projects, which is the opposite of what it promises. More immediately, `/check verify` walks `verify.md` literally, so this step will read as failed. If the removal was deliberate (carrying `status=all` forward would make the Active toggle link show delivered projects too, which is arguably better), that is a reasonable call — but it is a spec change, and nothing records it.

**Suggested fix**: Restore `&status=all` to match the spec and the verify step, or amend both spec 0010's Value sourcing row and `verify.md`'s AC-13 step to say the link deliberately relies on the archived default, and note why in the Consequences section.

### 🟡 `countActiveProjects` fetches every row to return a number, `src/projects/queries.ts:227-236`

**Problem**: Unchanged from the prior review. `findMany` with no column projection, returning `rows.length`, on every `/clients/[id]` render, purely to fill in a sentence in a confirm dialog that AC-14 describes as informational and never a gate.

**Why it matters**: It pulls full project rows (description included, up to 5,000 characters each) over the single pooled connection for a count, and the cost grows with a client's project history rather than staying flat.

**Suggested fix**: Add a `count` surface to `src/db/tenant/accessor.ts` alongside the `update` option this spec already added, or at minimum project to a single column via `columns`.

### 🟡 The client page runs the same projects query twice, `src/app/(agency)/(gated)/clients/[id]/page.tsx:69-71` and `src/projects/ui/projects-section.tsx:126-130`

**Problem**: `countActiveProjects(ctx, client.id)` and `listProjectsForClient(ctx, client.id, todayUtc())` issue the identical predicate — `eq(clientId) AND isNull(archivedAt)` — against the same table, in the same render, on the same request. One is a count of exactly the rows the other already has.

**Why it matters**: Two sequential round trips on a capped one-connection pool where one would do, on a page that already runs the client read and the contacts read. `agencyContext()` is `cache()`d so the context is free, but the queries are not.

**Suggested fix**: Have `ProjectsSection` surface the count it already loaded (render `ArchiveClientButton` from inside the section, or lift the single `listProjectsForClient` call into the page and pass rows down). That also fixes the next finding for free.

### 🟡 A projects read failure on the client page still escapes `ProjectsSection`'s containment, `src/app/(agency)/(gated)/clients/[id]/page.tsx:69-71`

**Problem**: Unchanged from the prior review. `ProjectsSection` goes to real trouble to contain its own read failure (`projects-section.tsx:122-148`: catch, log, render a local error state, rethrow only `TenantResolutionError`). The page calls `countActiveProjects` unguarded and earlier, so a failing `projects` read throws there first and the whole client page falls to `clients/[id]/error.tsx`.

**Why it matters**: The two reads hit the same table, so the failure the section guards against is precisely the one that trips the count first. The containment is therefore decorative: the page blanks either way. Resilience gap, not a break.

**Suggested fix**: Catch around `countActiveProjects` and fall back to `0` (which degrades to the existing dialog copy — correct for informational text), letting `TenantResolutionError` propagate as `loadProjects` already does. Merging the two reads as suggested above removes the second call entirely.

### 🟡 Two exported reads take an unvalidated id where their siblings parse it, `src/projects/queries.ts:206` and `:227`

**Problem**: `getProject` and `getClient` both `safeParse` the id and return `undefined` for a non-uuid, so a malformed id can never reach the driver. `listProjectsForClient` and `countActiveProjects` take `clientId: string` raw and pass it straight into `eq(projects.clientId, clientId)`.

**Why it matters**: Both are only ever called today with an id from an already-resolved client row, so there is no live bug. But they are exported module-level reads, and the next caller — the obvious one being a `/clients/[id]` variant that skips the `getClient` round trip — would get a PostgreSQL `invalid input syntax for type uuid` exception escaping into the page instead of an empty list. The inconsistency is the hazard, not today's behaviour.

**Suggested fix**: Parse `clientId` through `clients/schema`'s `clientId` schema at the top of both, returning `[]` / `0` on a miss, matching `getProject`.

## Nits

- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:104-125`, `clientOptions` is spread into a fresh array and then `.push()`-ed into. It is a local copy so nothing is shared, but AGENTS.md says "never mutate in place" — `[...options, ...(archivedOption ? [archivedOption] : [])]` says the same thing without the mutation.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:113`, the `getClient` lookup runs for `clientParam === ""` too (it costs nothing — `getClient` rejects the uuid parse before touching the database — but `Boolean(clientParam)` would skip it and match the `hasFilter` test one line below).
- ⚪ `src/projects/queries.ts:88-105` + `page.tsx:91`, an unrecognised `status` (say `?status=bogus`) is passed to the `<select defaultValue>` where no option matches, carried into both archived toggle links, and counted as a filter by `hasFilter`, while the query silently treats it as the default. Harmless, but the four places disagree about what an unknown value means.
- ⚪ `src/app/design/gallery.tsx:516-525`, the "client picker" sample lists "Harbour Books (archived)". The create picker (`listClientOptions`) never lists an archived client — that is AC-3 — and only the *filter* bar appends an archived option. The gallery entry sits under "Project workflow" beside the create-form move buttons, so it reads as the create picker.
- ⚪ `src/app/(agency)/(gated)/projects/[id]/page.tsx:115-121` (unresolved), `ProjectStatusActions` renders only inside `!archived` and is also handed `archived={archived}`, so the prop is always `false` at that call site. Drop one.
- ⚪ `src/app/design/gallery.tsx:497-510` (unresolved), the move buttons are hardcoded labels; mapping `PROJECT_STATUSES` through `nextStatuses` would make the gallery self-updating, which is the whole point of `src/projects/status.ts`.
- ⚪ `src/app/design/gallery.tsx:516` (unresolved), `aria-label={scoped("project-client-picker")}` gives the select the accessible name `light-project-client-picker`. Everywhere else `scoped()` feeds `id`/`name`/`htmlFor` and a `<Label>` supplies the name.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:65` and `new/page.tsx:15` (unresolved), `firstParam` is defined identically twice; `NO_RESULTS` is defined identically in `page.tsx:69` and `queries.ts:54`.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:93-127` (unresolved), `listProjects`, `listClientOptions` and `getClient` are three sequential awaits that `Promise.all` would collapse into one wait.
- ⚪ `src/projects/ui/projects-filter-bar.tsx:138,148` (unresolved), `aria-current="page"` is the more precise token than `aria-current="true"` for "this is the view you are on".
- ⚪ `docs/scope/scope.md:216`, "Review it (fresh model): `/check review projects`" is already ticked while this review is what decides that. `verify.md`'s AC-12 line is likewise pre-ticked with every other step blank.

## Strengths

- **The two fixes are real fixes, not patches over the symptom.** `listProjects` now trims the param and reserves `NO_RESULTS` for a non-empty non-uuid, which is exactly the `listClients` rule it had drifted from; and `hasFilter` compares against the *effective* default per view rather than mere param presence, so the archived list's own default (`all`) is handled correctly too. Both arrived with tests that fail against the old code.
- **The tenant layer change is exactly the right size and is properly fenced.** `scope()` became a rest-arg function and the caller's condition is spread into the same `and(org, ...extra)` as the org and id predicates (`accessor.ts:196-215`), so a caller's condition can only ever narrow. `accessor.test.ts:565-580` asserts the rendered SQL is one flat `("projects"."org_id" = $1 and "projects"."id" = $2 and "projects"."status" = $3)` with the exact bound params, and `tenancy.db.test.ts:542` proves against real PostgreSQL that agency A cannot reach agency B's project through it. No new ESLint exemption, no new raw-handle import, no widening of `withSystemAccess`.
- **The workflow rule really is single-source.** `MOVES` is a `Readonly<Record<ProjectStatus, ...>>`, so exhaustiveness over the status enum comes from the type rather than a switch that could rot, and `status.test.ts` walks all sixteen ordered pairs against an explicit allow-set rather than re-asserting the implementation.
- **`createProject` is closed by construction, not by checking.** The input schema has no `status` field at all, and a test smuggles `status: "delivered"` into the raw input and asserts it is dropped — the right way to prove AC-1.
- **Foreign-id indistinguishability is held everywhere.** `getProject`, `transitionProject`'s follow-up read, and both archive actions all collapse missing / foreign / non-uuid into the same `undefined` or `not_found` with an empty message.
- **`isRealCalendarDay` is genuinely correct**, not just regex-shaped: it round-trips through `Date.UTC` and compares back, so `2026-02-30` is refused and the two-digit-year trap falls out correctly.
- **`isOverdue` takes `todayUtc` as a parameter** rather than reading the clock, making the boundary testable (due today is not overdue, due yesterday is) and handing feature 18 a reusable rule.

## Test coverage

Strong, and above this repo's usual bar: 144 files / 2359 tests all green, with a test file beside every new module. The pure status module walks all sixteen status pairs plus the overdue boundary; the Zod schemas cover blank, over-cap, impossible-date and smuggled-field cases; each Server Action has the happy path, the refusals, and the idempotency or conflict branches; every UI component has an axe pass in both themes; the route pages cover the admin/member split (AC-12), the archived shape (AC-10, AC-11), the overdue badge, and the no-Clerk-credentials shape. `e2e/projects.spec.ts` adds the signed-out route coverage that was missing, and `listProjects`'s predicates are now compared as rendered SQL rather than shape-matched.

Remaining gaps:

1. **The compare-and-set condition is still `expect.anything()`** (`transition-project.test.ts:104-109`) — the Major above. Every archived/conflict case in that file mocks the miss rather than provoking it, so nothing in the suite would notice `isNull(projects.archivedAt)` disappearing from the condition.
2. **No test asserts the GET form's own submitted URL.** The page is now tested against the shape the form produces (`{ status: "open", client: "" }`), which closes the practical gap, but the form → URL step itself is still assumed rather than asserted.
3. **`listProjects` mocks `findMany` wholesale**, so the `with: { client: ... }` relation join is never exercised against a real schema — the flattening is tested, the join is not.
4. **`tenancy.db.test.ts` is `describe.skipIf(!url)`**, so the strongest isolation proofs only run where `DIRECT_URL` is set; worth confirming CI's second job actually sets it for this file, since it now carries the only real-database proof of the compare-and-set.
