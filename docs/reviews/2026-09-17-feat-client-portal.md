# Review, feat/client-portal, 2026-09-17

**Reviewed by**: Opus 5 (author on Sonnet)
**Scope**: 69 files (66 tracked + 3 untracked), branch vs `main` (merge base `f2c8da4`)
**Verdict**: Changes requested

## Summary

Spec 0014's client portal: a read only `/portal` for client contacts, with a cached `portalContext()` helper, a subscription gate, a `(contact)` route group for the chrome, four list/detail surfaces, a cross agency client switcher, and the gate wired into the two existing file routes. **The security core is genuinely good.** Tenant isolation is inherited by construction rather than re-implemented: every query takes a `ContactContext` (a staff call is a compile error), the contact accessor has no write methods at all, the three named doors are each minimal and scoped to a resolved id, and 19 database tests against real PostgreSQL run every query under two foreign contexts. I found no blocker and no way for a contact to reach another org's or another client's rows.

The headline issues are around the change, not inside it: the gate turns the codebase's only tenancy escape hatch into a per request `console.warn`, seven new pages and a layout shipped with no page level tests at all (every equivalent agency page has one), and three of the branch's test files are still untracked, including the only coverage of the AC-1/AC-2 redirect ladder.

`pnpm typecheck` and `npx vitest run src/portal src/app/portal` are green (109 tests, 13 files, database tests included); Prettier is clean on every changed file.

## Major

### 🟠 The gate writes a `console.warn` audit line on every portal request, `src/portal/gate.ts:56`

**Problem**: `portalAccess()` reads `subscriptions` through `unsafeTenantQuery(ctx, "portal gate", …)`. That helper calls `logEscapeHatch()` unconditionally (`src/db/tenant/unsafe.ts:34`), which emits a `console.warn` JSON line carrying `userId` and `orgId` (`src/db/tenant/log.ts:38`). `portalAccess` runs for every page render (via the cached `portalContext()`), plus once per `/deliverables/[id]/download` and once per `/portal/invoices/[id]/pdf`. Grep confirms `src/portal/gate.ts` is the **only** `unsafeTenantQuery` call site in `src/`.

**Why it matters**: two distinct costs. First, it contradicts spec 0014's own Security model line, "Nothing in the portal is logged except the AC-11 refusal line" — every page view now logs an identified user. Second, and worse, it destroys the signal the escape hatch log exists for: `src/db/tenant/unsafe.ts` says the hatch "is meant to be conspicuous and rare: if it grows past a handful of call sites, the accessor is missing a shape". Once `tenant.escape_hatch` is the most frequent warn line in production, nobody can read that channel any more, and a genuinely new unscoped query lands invisibly. At warn level it may also trip log based alerting.

**Suggested fix**: separate "a hand written tenant query exists here" (a build time / call site fact, worth logging once or counting) from "a hand written tenant query ran" (a per request fact, not worth logging). Options, roughly in order of preference: give `unsafeTenantQuery` an opt out for audited-and-accepted call sites; or make the gate's `subscriptions` read a first class shape on the accessor (the accessor already knows `subscriptions` has no client path — an explicit "org scoped, no client narrowing" read would remove the hatch entirely and is what spec 0003's own Follow-up anticipates); or, at minimum, drop `logEscapeHatch` to debug level and record the call site inventory in a test instead. Whichever is chosen, spec 0014's Security model line needs to match.

### 🟠 Seven new pages and a layout with zero page or layout tests, `src/app/portal/(contact)/`

**Problem**: the branch adds `(contact)/layout.tsx`, `(contact)/page.tsx`, `projects/page.tsx`, `projects/[id]/page.tsx`, `files/page.tsx`, `invoices/page.tsx`, `invoices/[id]/page.tsx` and `unavailable/page.tsx`, and tests exactly two of the eight route files (`error.test.tsx`, `not-found.test.tsx`). It also **deletes** `src/app/portal/invoices/[id]/page.test.tsx` along with its placeholder page and puts nothing in its place. By contrast every agency page has one (`src/app/(agency)/(gated)/{clients,projects,invoices,dashboard}/…/page.test.tsx`, plus `layout.test.tsx`), so this is a departure from the area's own established bar, not from my taste.

The uncovered logic is branching and security relevant:
- `layout.tsx:27` returns bare `children` (no chrome, and no `portalContext()` call, so no gate) when Clerk is unconfigured — repeated in six more places as `isClerkConfigured() ? … : NO_RESULTS`. Nothing pins that the two halves stay in step.
- `unavailable/page.tsx:66` is the *reverse* gate: `isPortalReadable(access.level) → redirect("/portal")`. AC-2 makes this the thing that stops a restored agency's contact being stranded; it has no unit test.
- `projects/[id]/page.tsx:67` and `invoices/[id]/page.tsx:54,61` are the `notFound()` calls AC-12 rests on.
- Empty vs populated branches on all four list pages, and `generateMetadata`'s `portalContext()` calls, which can redirect.

**Why it matters**: the only thing exercising these paths is `e2e/portal-contact.spec.ts`, and by the spec's own Follow-up that suite **cannot run in CI** — the `browser` job provisions no database, and the project is not even defined unless five secrets are set. So in CI, today, every one of those branches has no coverage of any kind. A refactor that, say, drops the gate from `unavailable/page.tsx` or inverts an `isClerkConfigured()` check goes green.

**Suggested fix**: add `page.test.tsx` beside each new page and `layout.test.tsx` beside the layout, in the shape the agency ones already use (mock `portalContext`/the query module, assert the redirect, the `notFound()`, the empty state and one populated row). The `unavailable` reverse gate and the two `notFound()` paths are the ones I would not merge without.

### 🟠 Three test files and two edits are untracked/uncommitted

**Problem**: `git ls-files --others` shows `src/portal/context.test.ts`, `src/portal/ui/portal-pagination.test.tsx` and `src/portal/ui/portal-sign-out-link.test.tsx` are untracked, and `docs/scope/scope.md` plus `src/invoices/ui/invoices-ui.test.tsx` are modified but uncommitted.

**Why it matters**: `src/portal/context.test.ts` is the *only* coverage of `portalContext()`'s redirect ladder — the staff → `/dashboard` redirect, the `no_contact` → `/onboarding` redirect, that `no_mirror_row` and a database failure propagate rather than redirecting, and that the gate redirect happens before any name is resolved. That is AC-1 and AC-2 in full. If the branch merges as committed, all of it disappears, along with the pagination and sign out coverage and the `InvoiceDocument` `clientHref` tests. The file's own header even notes it was written because `verify.md` claimed coverage that did not exist on disk — losing it would recreate exactly that.

**Suggested fix**: `git add` all five and commit before opening the PR.

## Minor

### 🟡 The portal's user menu offers a `Settings` link that silently bounces, `src/portal/ui/portal-top-bar.tsx:45`

**Problem**: the top bar renders the shared `UserMenu`, whose menu contains `<Link href="/settings">` (`src/ui/shell/user-menu.tsx:84`). `/settings` is in `AGENCY_ROUTES` (`src/proxy.ts:54`), so a contact (who never carries an `orgId` claim) is redirected to `/onboarding` (`src/proxy.ts:84`), which sees an accepted contact row and redirects to `/portal` (`src/app/(auth)/onboarding/page.tsx:98`). The contact clicks Settings and lands back where they started, with no explanation.

**Why it matters**: AC-4 says "the existing `UserMenu`", so this is a spec level oversight rather than a deviation, but a strictly read only portal that offers a control which does nothing is a real papercut, and the double redirect costs two round trips.

**Suggested fix**: give `UserMenu` an optional prop to suppress the Settings item (or to supply its own items), and pass it from the portal top bar. Worth a line in spec 0014's Consequences either way.

### 🟡 Most dates are not in a `<time dateTime>` element, contrary to AC-15

**Problem**: AC-15 requires "dates are rendered in a `<time dateTime>` element". Only the file `Added` dates comply (`(contact)/page.tsx:115`, `files/page.tsx:111`, `projects/[id]/page.tsx:123`). Bare strings elsewhere: the overview's `Due {project.dueDate}` (`(contact)/page.tsx:79`) and `Due {invoice.dueDate}` (`:147`), the projects table's `Due` column (`projects/page.tsx:47`), the invoices table's `Issued` and `Due` columns (`invoices/page.tsx:41,48`), the project page's `Due date` detail (`projects/[id]/page.tsx:85`), `Paid on …` (`invoices/[id]/page.tsx:75`) and the invoice document's `Issued`/`Due` details (`src/invoices/ui/invoice-document.tsx:150,156`).

**Why it matters**: the raw ISO day string is what is displayed, so assistive technology and any date-aware consumer get no machine readable value. The agency screens have the same gap, so a shared fix pays twice — but AC-15 asks for it specifically here.

**Suggested fix**: a tiny `<DayDate value={…} />` in `src/ui/patterns/` that renders `<time dateTime={value}>{value}</time>` with an em dash fallback, used by both areas.

### 🟡 `listAcceptedContactRows` lists soft deleted agencies, `src/db/tenant/contact-rows.ts:46`

**Problem**: the join to `organizations` carries no `isNull(organizations.deletedAt)`, unlike `resolveStaffContext` (`src/db/tenant/context.ts:104`), which spec 0005 AC-14 made deliberate. `resolveContactContext` omits it too (pre-existing), so a contact of a soft deleted agency still resolves a context, still appears in the switcher, and still reads that agency's projects, files and invoices.

**Why it matters**: the surfaces already disagree with each other, which is the tell. `agencyProfile()` *does* filter `deleted_at` (`src/db/tenant/organization.ts:55`), so for a deleted org the portal renders with an empty agency name, the unavailable copy reads "'s ClientHQ account needs attention…", and `handleInvoicePdfRequest` 404s on `agency === undefined` while the invoice screen renders fine. Nothing sets `organizations.deleted_at` today (feature 17 is unbuilt), so this is latent rather than live — but it becomes a real data exposure the day the Clerk webhook lands.

**Suggested fix**: add `isNull(organizations.deletedAt)` to this query's `where`, and open a follow up for the same predicate in `resolveContactContext`. A database test with a soft deleted org would pin it.

### 🟡 `/portal/unavailable` has neither a loading skeleton nor an error boundary, `src/app/portal/unavailable/page.tsx`

**Problem**: it sits outside `(contact)` (correctly — it must render for an unreadable level), so it inherits neither `(contact)/loading.tsx` nor `(contact)/error.tsx`, and has no file of its own. AC-15 says "every portal page has a `loading.tsx` skeleton".

**Why it matters**: the page awaits two database reads (`portalContextForUnavailable()` and `listAcceptedContactRows`). A slow read shows nothing; a failing one falls through to the root boundary, which is exactly the outcome `(contact)/error.tsx`'s own comment calls "a documented, accepted gap" for the layout — but here it applies to an ordinary page, which is avoidable.

**Suggested fix**: add `src/app/portal/unavailable/loading.tsx` and `error.tsx` in the shape the `(contact)` ones already have.

### 🟡 `listProjectFiles` takes an unparsed id while its sibling parses one, `src/portal/queries.ts:339`

**Problem**: `getPortalProject(ctx, id)` runs `portalId.safeParse(id)` and returns `undefined` on a miss (`:247`). `listProjectFiles(ctx, projectId)` drops the string straight into `eq(deliverables.projectId, projectId)` with no parse.

**Why it matters**: not exploitable — the accessor's client predicate still scopes the row set, and today's one caller passes an already validated `project.id`. But a non uuid reaches PostgreSQL and throws `invalid input syntax for type uuid`, so the next caller gets a 500 where the sibling gives an empty list. It also reads against the house rule that Zod parses everything crossing into the server.

**Suggested fix**: parse with `portalId` and return `[]` on failure, matching `getPortalProject`.

### 🟡 Three spec/code mismatches worth reconciling one way or the other

**Problem**:
1. AC-4 and the Modules list name `src/portal/ui/portal-shell.tsx` as the chrome. There is no such file — the chrome is `(contact)/layout.tsx` plus `portal-top-bar.tsx` and `section-nav.tsx`. But `src/portal/ui/portal-shell.test.tsx` exists and tests five *other* components (`portal-top-bar`, `section-nav`, `client-switcher`, `portal-empty-state`, `overview-section`), so AGENTS.md's "tests sit beside the source they cover" no longer holds for any of them.
2. The Modules list says `portalContext()` returns `{ ctx, access, clientName, agencyName, contactRows }`. It returns the first four. `layout.tsx:32` and `unavailable/page.tsx:71` each issue their own uncached `listAcceptedContactRows` read as a result — correct, just a second query per request that the spec had folded into the cached helper.
3. AC-10's PDF link accessible name is `Download PDF <display number>`; the implementation renders `Download PDF` plus an `sr-only` span holding the number (`invoice-document.tsx:177-180`), which does produce that name — fine, but the e2e assertion only matches `/Download PDF/`, so the number half is unpinned.

**Why it matters**: none of these is a bug; all three make the spec a slightly unreliable map of the code, which is what the next reader will trust.

**Suggested fix**: split `portal-shell.test.tsx` into per component test files (or rename it to match one), and amend AC-4/the Modules list in spec 0014 to describe what was actually built.

### 🟡 `next.config.ts:9` reads `process.env` directly

**Problem**: `distDir: process.env.NEXT_DIST_DIR ?? ".next"`. AGENTS.md: "Every environment variable is added to the Zod schema in `src/lib/env.ts` and read through `env()`. Never `process.env` directly."

**Why it matters**: small in itself, but the rule earns its keep by being absolute — and `NEXT_DIST_DIR` is neither in `src/lib/env.ts` nor in `.env.example`, unlike the three `E2E_CLERK_CONTACT_*` variables this same branch added properly. Someone reading `.env.example` has no way to learn it exists. (`switchContact`'s `process.env.NODE_ENV` at `switch-contact.ts:72` is *not* a finding: it mirrors `src/contacts/accept-invitation.ts:96` exactly, and `NODE_ENV` is not a configured variable.)

**Suggested fix**: either add it to the Zod schema and `.env.example` as optional, or add an explicit carve out to AGENTS.md for build config files that load before `env()` exists.

## Nits

- ⚪ `src/portal/queries.ts:360-370`, the doc comment "Groups an already ordered page of files under a heading per project (AC-8)…" now sits above `export type OverviewData`, not above `groupFilesByProject` at `:393`, which has none. A block was clearly inserted between them.
- ⚪ `e2e/portal-contact.spec.ts:46` skips on `E2E_CLERK_CONTACT_USERNAME`/`PASSWORD` but not `E2E_CLERK_CONTACT_USER_ID`, which AC-16 names as the third gate. The `playwright.config.ts` guard checks all five, so this is belt only, but the file's own comment calls itself "a second line of defence".
- ⚪ `src/portal/queries.ts:163,234` sort in place (`rows.sort(…)`, `mapped.sort(…)`) while `listPortalFiles`/`listProjectFiles` `.slice()` first. Harmless — both arrays are freshly `map`ped — but inconsistent within one file, given the immutability rule.
- ⚪ `src/portal/queries.ts:396-416`, `groupFilesByProject` builds a mutable accumulator with an imperative `for` and a `!` assertion; it is the one spot in the feature that mutates. A `reduce` over a `Map` would read the same and match the house style.
- ⚪ `src/portal/gate.ts:53`, `portalAccess` is not `cache()` wrapped while its agency twin `agencyAccess` is (`src/access/gate.ts:53`). It happens to run once per page because `portalContext()` is cached, so nothing is wrong today; wrapping it would make that structural rather than incidental.

## Strengths

- **Isolation by type, not by discipline.** Every function in `src/portal/queries.ts` takes `ContactContext` rather than `TenantContext`, so a staff call will not compile, and `ContactAccessor` (`src/db/tenant/accessor.ts:134`) is a read-only type — the read only guarantee is the absence of methods, not a runtime check anyone can forget.
- **The tenancy tests actually try to break it.** `src/portal/queries.db.test.ts` runs every list and the detail read under a contact of a different client of the *same* agency and a contact of another agency, against real PostgreSQL in a rolled back transaction, and asserts zero rows for each — 19 cases covering archived projects, hidden and pending deliverables, files on archived projects, draft and void invoices, and the 26 row paging boundary.
- **`switchContact` verifies rather than trusts, and proves it.** It parses with Zod, then checks the id against `listAcceptedContactRows(ctx.userId)` — a forged id and a since-unaccepted row are both `not_found` with identical copy, so nothing leaks which case applied, and `switch-contact.test.ts:153` ("reads this person's own rows, not a caller supplied client or org") pins exactly that.
- **One `InvoiceDocument` for three surfaces.** Making `clientHref` optional means a contact structurally cannot be handed a link into `/clients/[id]`, and `invoices-ui.test.tsx` asserts both the link and the plain text branch plus that `pdfHref` is used verbatim rather than derived from an id the portal row no longer carries.
- **Honest about what is not true.** The build plan records that "green in CI" means a local run, that Next 16 answers `200` rather than `404` for a streamed `notFound()` (rather than quietly claiming AC-12), and that the seeded R2 bucket has no real object so the download test accepts `302` or `404`. `src/portal/context.test.ts`'s header notes that `verify.md` claimed coverage that did not exist and writes it for real. That is the kind of note that makes the rest of the document trustworthy.
- **Copy pinned once.** `src/portal/copy.ts` is shared between the overview blocks and the full list pages, so the AC-5/AC-6/AC-8 wording cannot drift between them — a drift the author found and fixed during task 3 rather than after.

## Test coverage

**Well covered.** The pure logic (`compareInvoicesForPortal`, `compareProjectsForPortal`, `groupFilesByProject`, `parsePageParam`, `isPortalReadable`) has focused unit tests; `portalAccess` is tested across all four levels plus the invariant break and a database failure; `switchContact` has five tests including the exact `console.warn` shape and the "reads own rows" case; `listAcceptedContactRows` has three database tests (two agencies ordered, another user's row absent, an unaccepted row excluded); both gated routes test `full`/`grace`/`locked`/`unsubscribed` and assert the staff branches are untouched; `queries.db.test.ts` is the strongest file in the branch. Component tests cover the top bar's two branches, the section nav's `aria-current`, the switcher's menu, refusal copy and focus return on Escape, the pagination window, the empty state and both error pages, each with axe in both themes. 109 tests pass locally.

**Untested.** All eight new route files except `error.tsx` and `not-found.tsx` (see the Major above) — in particular the `unavailable` reverse gate, the two `notFound()` paths and the seven `isClerkConfigured()` branches. `overviewData`'s composition (the `OVERVIEW_CAP` slice and the `unpaidOnly` flag reaching the query) is only covered transitively. `listProjectFiles` has no database test with a foreign `projectId` passed explicitly, unlike `getPortalProject`. And the Playwright suite that is meant to cover the end to end walk cannot run in CI at all today, which the spec's Follow-up acknowledges — so the effective CI coverage of this feature is the unit and database tests alone.
