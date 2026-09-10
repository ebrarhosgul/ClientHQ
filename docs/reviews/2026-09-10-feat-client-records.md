# Review, feat/client-records, 2026-09-10

**Reviewed by**: Opus 5 (author on Sonnet)
**Scope**: 46 files, branch vs `main` (merge base `1fdf670`)
**Verdict**: Blocked

## Summary

Spec 0006's client records feature: the migration for eight new `clients` columns, the create/update Zod schemas, four Server Actions, four screens, two new UI patterns, and a broad unit suite (105 tests pass locally). The tenant story is the strongest part: every read and write goes through `tenantDb`/`withTenantAction`, nothing imports the raw handle, and a foreign agency's id is `undefined` by construction, so AC-10 and AC-11 hold structurally rather than by discipline.

Two things stop it merging. First, clearing a previously filled optional field on the edit form is silently ignored — Drizzle's `.set()` drops `undefined` keys and the schema turns every blanked input into `undefined`, so a phone number, email, note or address line can be set but never removed. I confirmed this by generating the SQL. Second, no code path validates that a client id is a UUID, so a malformed id produces a Postgres `22P02` error (verified against the dev database) instead of the not-found the spec promises. Alongside those, the list query loads every matching row and paginates in JavaScript.

## Blockers

### 🔴 Clearing an optional field on edit is silently discarded, `src/clients/update-client.ts:31`

**Problem**: `updateClientInput` preprocesses a blank string to `undefined` (`src/clients/schema.ts:13-23`), so a field the user emptied arrives in the patch as `undefined`. `tenantDb().update()` passes the patch to Drizzle's `.set()` (`src/db/tenant/accessor.ts:268`), and Drizzle's `mapUpdateSet` filters out every `undefined` entry before building the statement. Confirmed by generating the SQL for a patch of `{ name, phone: undefined, notes: undefined }`:

```
update "clients" set "name" = $1 where "clients"."id" = $2
```

`phone` and `notes` are simply absent from the statement.

**Why it matters**: A staff member who deletes a client's phone number, company email, notes, industry, or any of the six billing address lines gets a success, a redirect, and the old value still on the detail page. There is no error and no clue why. It breaks AC-7 ("a signed in staff member can edit **any** field on a client... and the new values show immediately"), it makes stale contact data impossible to remove, and it is the kind of thing that becomes a data-deletion request the product cannot honour. `restoreClient` is unaffected because it sends an explicit `null`, which is exactly the distinction that hides the bug.

**Suggested fix**: In `updateClient`, an optional field that came back `undefined` from parsing has to become `null` in the patch before it reaches `db.update` — that is what makes "the user cleared it" and "the user did not send it" the same statement the full-replace semantics in the file's own doc comment promise. Either map the parsed input over the known optional keys, or have the update schema emit `null` rather than `undefined` for a blank (a `.transform(v => v ?? null)` on each optional field, in the update schema only, so `createClient` keeps its current insert behaviour). Whichever way, add a test that starts from a fully populated client, clears one field, and asserts the patch carries an explicit `null` — the current `update-client.test.ts` mocks `db.update` and asserts with `objectContaining`, which cannot see a dropped key.

## Major

### 🟠 A client id is never validated as a UUID, so a malformed id is a driver error, not "not found", `src/app/(agency)/clients/[id]/page.tsx:59`

**Problem**: `clients.id` is a `uuid` column, but nothing checks the shape of the id before it reaches a query. The route param goes straight from `await params` into `getClient` (detail `page.tsx:59`, `edit/page.tsx:33`), and the action schemas use `z.string().min(1)` (`src/clients/schema.ts:58`, `src/clients/archive-client.ts:15`). Against the dev database:

```
select id from clients where id = 'not-a-uuid'
→ ERROR code= 22P02 | invalid input syntax for type uuid: "not-a-uuid"
```

`22P02` is not one of the two codes `toActionError` translates (`src/db/tenant/action.ts:137`), so it propagates. On a page that means `error.tsx` renders instead of `notFound()`; in a Server Action it means the action rejects rather than returning a `Result`, and in `ClientForm` that rejection happens inside the `useActionState` reducer with nothing to catch it.

**Why it matters**: AC-11 says a direct link to an id that is not this agency's "behaves exactly like a client that does not exist". A typo'd link, a crawler on `/clients/foo`, or any probe gets a 500-shaped error state and a Sentry event instead of a 404, and every such request is a wasted database round trip an unauthenticated-ish caller can generate at will. It also contradicts the root `AGENTS.md` rule that Zod parses every input crossing into the server, URL params included — the `[id]` param currently crosses with no parse at all. Note the e2e suite cannot see this: it runs with no Clerk key, so `findClient` short-circuits to `undefined` before any query, which is why `/clients/some-client-id` shows "Not here yet" there.

**Suggested fix**: Make the id a UUID everywhere it is accepted — `z.uuid()` in `updateClientInput` and in `archive-client.ts`'s `clientIdInput` (which turns a bad id into a clean `validation` or `not_found` `Result`), and parse the route param on both `[id]` pages, calling `notFound()` when it does not parse. The narrower shape costs nothing and collapses "malformed", "missing" and "another agency's" into the single outcome the spec asks for.

### 🟠 The client list reads every matching row and paginates in memory, `src/clients/queries.ts:66`

**Problem**: `listClients` calls `db.findMany` with only `where` and `orderBy`, then computes `total` from `matches.length` and returns `matches.slice(start, start + 25)`. `FindOptions` already exposes `limit` and `offset` (`src/db/tenant/accessor.ts:44-45`) and neither is used, so page 1 of a 5,000-client agency transfers 5,000 rows — every column, including 5,000-character `notes` — to render 25 of them.

**Why it matters**: The spec's own invariant accepts an unindexed `ILIKE` scan at expected row counts, but that is about the scan, not about shipping the whole result set over a pooled connection capped at one connection per function (`src/db/AGENTS.md`). Latency and memory grow linearly with an agency's client count on the single most-visited screen in the product, and the same shape will be copied into projects and invoices, which have far more rows. The `search` path is the worst case, since a broad term returns nearly everything.

**Suggested fix**: Push the window into SQL: pass `limit: CLIENTS_PAGE_SIZE` and `offset` to `findMany`. That needs a total to compute `pageCount`, and the accessor has no count method today, so this is a small addition to `src/db/tenant/accessor.ts` (a scoped `count(table, opts)` alongside `findMany`, built from the same `scope()` predicate) rather than something `src/clients` can fix alone. Clamping then needs a re-order — resolve the count first, clamp, then fetch the page. Worth doing now while the shape is one feature and not four.

## Minor

### 🟡 `%` and `_` in a search term are live ILIKE wildcards, `src/clients/queries.ts:63`

**Problem**: The term is interpolated into the pattern as `%${trimmed}%` with no escaping. Drizzle binds it as a parameter, so there is no injection risk, but the wildcards still apply: searching `50%` matches every client, and `a_c` matches `abc`.

**Why it matters**: Company names contain `%` and `_` often enough (`50% Design`, `a_b Studio`) that a staff member searching for one gets a silently wrong result set rather than the single row they wanted.

**Suggested fix**: Escape `\`, `%` and `_` in the trimmed term before building the pattern, and add the `ESCAPE` clause Postgres needs. A single case in `queries.test.ts` pinning `50%` to a literal match covers it.

### 🟡 The detail and edit pages each run the same query twice, `src/app/(agency)/clients/[id]/page.tsx:20`

**Problem**: `generateMetadata` and the page component both call `findClient(id)`, and `getClient` is not memoised. `agencyContext` is wrapped in React's `cache()` (`src/auth/context.ts`), so context resolution is deduped, but the `clients` read itself is not — two identical round trips per detail page render, and the same again on `edit/page.tsx:15`.

**Why it matters**: It doubles the query cost of the two most-linked pages against a pool capped at one connection, for a value that is provably identical within the request.

**Suggested fix**: Wrap the per-route `findClient` helper in `cache()` from `react`, the way `agencyContext` already does; the codebase has the pattern and the reasoning documented.

### 🟡 A validation failure with no matching form field leaves the user with a silent no-op, `src/clients/ui/client-form.tsx:128`

**Problem**: The alert renders only when `state.error.code !== "validation"`, on the assumption that every validation failure has a field to sit beside. `updateClientInput` can fail on `id` (`schema.ts:58`), which no `Field` renders, and any future key added to the schema without a matching input has the same shape.

**Why it matters**: The submit button returns to rest, nothing appears anywhere on the page, and the user has no way to learn the save was refused. A silent failure on a save is worse than an ugly error.

**Suggested fix**: Show the alert whenever the failure produced no field error that is actually rendered — e.g. fall through to the alert when `fieldErrors` is empty or contains only keys the form does not display.

### 🟡 `ConfirmDialog` was never added to `/design`, `src/app/design/gallery.tsx:414`

**Problem**: The gallery gained an "Address fields" section but no confirm dialog section, though `src/ui/AGENTS.md` requires every new component to appear in `/design` "in every state it has". `verify.md:30` flags this itself and leaves the box unchecked.

**Why it matters**: `/design` is the project's contract for reviewing both palettes in one place, and the e2e axe pass runs against `/design`, so the new dialog is outside the browser-level accessibility sweep. (It does have axe coverage in both themes in `patterns.test.tsx`, so this is a gallery and e2e gap, not an untested-a11y one.)

**Suggested fix**: Add a section rendering `ConfirmDialog` in its trigger, open and error states, as the address fieldset section does.

## Nits

- ⚪ `src/clients/ui/clients-filter-bar.tsx:75`, `aria-current="true"` on the Active/Archived links; `aria-current="page"` is more precise and is what `ClientsPagination` already uses for the same idea.
- ⚪ `src/ui/primitives/button.test.tsx:48`, changing the fixture href from `/clients` to `https://example.com` is unrelated to this feature and unexplained in the commit; if a typed-routes constraint forced it, a one-line comment would save the next reader the hunt.
- ⚪ `src/clients/update-client.test.ts:47` and `src/clients/archive-client.test.ts:47`, the hand-rolled `withTenantAction` mock calls `parsed.error.flatten()` while the real wrapper uses `flattenError` from Zod 4; harmless today, but the mock drifting from the wrapper is how a test starts proving the wrong thing.
- ⚪ `drizzle/0001_new_brother_voodoo.sql:9`, the new CHECK is added validating, so it will fail the migration if any existing row holds a mixed-case `company_email`. Fine for current data; worth knowing before it runs anywhere with history.
- ⚪ `src/clients/archive-client.ts`, the file exports `restoreClient` too, and `restore-client-button.tsx` imports it from `@/clients/archive-client`, which reads oddly. A name covering both states would be kinder.

## Strengths

- The tenant story is right by construction, not by remembering: every read is `tenantDb(ctx)`, every write is `withTenantAction`, `org_id` is stamped from context and is a type error to supply, and `createClient`'s test explicitly asserts neither `id` nor `orgId` can arrive from input. AC-10 and AC-11 hold without any per-callsite discipline.
- Idempotent archive and restore are genuinely tested, including the row-disappears-between-read-and-write race, which is the case most authors skip.
- `blankToUndefined` is the right shape for a form boundary, and `schema.test.ts` exercises every cap at both `max` and `max + 1` rather than picking one field and hoping.
- `Field` and `AddressFields` wire `aria-describedby`, `aria-invalid` and `role="alert"` so no feature has to remember them, and `ConfirmDialog` has axe coverage in both themes plus a real pending-state test using a deferred promise.
- `pageWindow` is clean, pure and well tested, including the ellipsis boundaries.
- Every module's doc comment names the acceptance criteria it satisfies, and the tests carry `covers:` headers. That made this review substantially faster and is worth keeping as a habit.

## Test coverage

105 tests across 15 files pass, and the unit-level coverage of the schemas, the four actions, the three list components and all four pages is genuinely thorough — empty states, filter permutations, pagination boundaries, `notFound()` digests, and the degraded no-Clerk path are all asserted.

The gaps are where the mocks stop:

- **The blocker is invisible to the suite.** `update-client.test.ts` mocks `db.update` and asserts with `expect.objectContaining`, which cannot fail on a dropped key, and no test starts from a populated client and clears a field. A test at the accessor level (or an integration test against the real table) is what would have caught it.
- **In-memory pagination is enshrined rather than questioned.** `queries.test.ts` mocks `findMany` to return the full row set, so the tests pass precisely because the code slices in JavaScript; they would need rewriting alongside the fix.
- **`withTenantAction` is mocked away in all three action test files**, so `requireStaff` is never exercised for these four actions. AC-12's "a client contact context reaching one of the four Server Actions directly is refused" rests entirely on the generic proof in `action.test.ts` plus code inspection — `verify.md:18` leaves that box unchecked too.
- **The e2e suite covers only the signed-out shape.** `e2e/clients.spec.ts` is a real improvement over having nothing, but the create/edit/archive/restore/search loop, cross-tenant isolation (AC-11), and concurrent edits (AC-14) have no automated coverage at any level — they are manual `verify.md` checks. That is a defensible tradeoff while there is no test-session harness, but it is worth naming: the two Majors and the Blocker above all live in exactly the band the mocks cannot see.
- **AC-13's axe scan on the empty state** is covered by `e2e/clients.spec.ts` in both themes, which closes the item `verify.md:19` had left open.
