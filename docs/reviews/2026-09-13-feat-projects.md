# Review, feat/projects, 2026-09-13

**Reviewed by**: Claude Opus 5 (author on Claude Sonnet 5)
**Scope**: 56 files, branch vs `main` (merge base `dc34816`): five commits since the branch point plus uncommitted working tree changes in 12 source and spec files (`git diff HEAD`), reviewed together as one change
**Verdict**: Approve with nits

## Summary

This is the fourth pass over spec 0010. The uncommitted working tree answers the third pass in full: the archive and restore tests now capture the config handed to `withTenantAction` and run the real role guards on it, so `requireRole: "admin"` is asserted and a member is refused with `forbidden` before any read; every one of the five actions has its `revalidate` pinned to `PROJECT_REVALIDATE`; the conflict message moved out of the clicked button into `ProjectStatusActions`'s own state, with the detail page keeping the component mounted while archived so the sentence survives the refresh; an archived client's Projects section no longer offers a New project link; and the positive client filter finally renders its predicate. Each fix arrived with a test that fails against the old code, and the spec's Value sourcing table was updated where behaviour changed. `typecheck`, `lint`, `format:check` and `test` (144 files, 2380 tests) are green, and the 19 real PostgreSQL tenancy tests ran against the database rather than skipping.

Nothing found this pass rises above Minor. The one Minor is a consequence of the AC-9 fix: because the error is now cleared only by the next move, a conflict message can outlive a later, unrelated refresh (conflict "This project is archived", then Restore on the same page) and sit beside buttons it contradicts. The rest are nits, most carried over untouched from earlier passes.

## Status of the prior review's findings

| Prior finding | Status |
|---|---|
| 🟠 Nothing proves `archiveProject` and `restoreProject` are admin only | **Resolved.** The `withTenantAction` mock in `src/projects/archive-project.test.ts:44-119` pushes every config it receives and reproduces the wrapper's own dispatch (`requireAdmin` when `requireRole === "admin"`, `requireStaff` otherwise, on the real guards from `@/db/tenant`), which matches `src/db/tenant/action.ts:181-185`. `:143-150` asserts `requireRole` is `"admin"` on both actions and `:152-175` proves a `member` context gets `{ code: "forbidden" }` with `findById` and `update` never called. Deleting either `requireRole` line now fails four tests. |
| 🟡 The conflict message is unmounted by the refresh that follows it | **Resolved.** `src/projects/ui/project-status-actions.tsx:102-112` holds one `useState<ActionError \| undefined>` in the group; both buttons report through `onDone(error?)` and the alert renders beside the group at `:143-147`, outside any button. `:105` keeps the component rendering when there is an error but no moves, and `src/app/(agency)/(gated)/projects/[id]/page.tsx:115-122` mounts it unconditionally so a refresh that archives the project cannot unmount the state. `project-status-actions.test.tsx:143-236` and `:273-316` replay the refresh as a rerender with the new status (and with `archived`) and assert the sentence is still there; `[id]/page.test.tsx:132-144` pins the always mounted call. The spec's Value sourcing row (`docs/specs/0010-projects/index.md:132`) now says this rather than claiming parity with `archive-client-button.tsx`. |
| 🟡 An archived client's page offers a New project link that cannot succeed | **Resolved.** `src/projects/ui/projects-section.tsx:16,36` takes `archivedAt`, `:83-90` hides the link when set, `:98-102` and `:112-116` say why. `projects-section.test.tsx:80-111` covers both the empty and the populated archived shapes and `:143-149` adds the axe pass. Spec row at `index.md:139`. |
| 🟡 The positive client filter never reaches an assertion | **Resolved.** `src/projects/queries.test.ts:264-286` passes a real uuid and compares the rendered `where` strictly against `and(isNotNull(archivedAt), eq(status, "in_review"), eq(clientId, <uuid>))`. |
| 🟡 No test asserts any action's `revalidate` config | **Resolved.** `archive-project.test.ts:177-184`, `create-project.test.ts:88-96`, `transition-project.test.ts:110-118`, `update-project.test.ts:88-96` each assert `config.revalidate` is `PROJECT_REVALIDATE` by identity. |
| ⚪ `ProjectStatusActions` handed `archived={archived}` inside `!archived` | **Resolved** as a side effect of the AC-9 fix: the prop is now the thing that hides the buttons. |
| ⚪ The other fifteen nits | **Unresolved**, all still present at the line numbers re listed under Nits. |

## Minor

### 🟡 A conflict message survives later, unrelated refreshes and can contradict the buttons beside it, `src/projects/ui/project-status-actions.tsx:102-112`

**Problem**: `error` is cleared in exactly one place: the next `onDone` from a move button. That is the right rule for the refresh that immediately follows the conflict (the point of the fix), but every later refresh keeps the message too. Two reachable sequences on the same page load: (1) "Start work" hits a conflict because an admin archived the project, the alert reads "This project is archived", the same admin clicks Restore on this page, `RestoreProjectButton` refreshes, the buttons come back, and "This project is archived" is still on screen beside "Start work". (2) "Mark delivered" hits "already moved to In progress", the person later archives from this page, and the sentence stays beside the Archived badge. The tests replay only the one refresh (`project-status-actions.test.tsx:163-168`), so they cannot see the second.

**Why it matters**: The copy is now wrong rather than merely absent, on the same surface the third pass was fixing. It is rare (a conflict followed by a second change without navigating away) and nothing is written wrongly, so Minor.

**Suggested fix**: Record the props the error was raised against, and treat the first prop change after it as the refresh the message is for and any further change as the moment to drop it. React's adjust state during render pattern (compare the current `status`/`archived` with the stored pair and call the setter during render) does this without an effect. A smaller alternative that covers sequence (1) is to clear the error whenever `archived` flips from `true` to `false`. Either way, add a third rerender to the existing test.

## Nits

New this pass:

- ⚪ `src/projects/ui/project-status-actions.tsx:72-77`, `ConfirmedMoveButton` returns `{ ok: true }` for a failed action so the dialog closes. `ConfirmDialog`'s contract (`src/ui/patterns/confirm-dialog.tsx:35-42`) is "returns whether it succeeded"; this is the first caller that lies to it, with a comment and a test (`:272-291`) pinning the lie. The next caller that wants close on failure will copy it. A `closeOnError` prop, or a `{ ok: false, close: true }` shape, would make the behaviour a feature of the dialog rather than a trick in the caller.
- ⚪ `src/projects/ui/project-status-actions.tsx:109-112`, after a conflict the button that had focus unmounts with the refresh, so keyboard focus falls to `<body>`; for "Mark delivered" the Radix dialog returns focus to a trigger that is about to disappear. The `role="alert"` announces the message, so this is not a WCAG failure, but focusing the group (`tabIndex={-1}` plus a ref) once the fresh buttons land would keep a keyboard user where they were.
- ⚪ `src/projects/ui/projects-section.tsx:100,114`, two sentences for one fact: "This client is archived, so no projects can be added until they are restored." in the empty state and "This client is archived. Restore them to add projects." under a populated list. `ContactsSection` uses the second form; pick one.
- ⚪ `docs/specs/0010-projects/index.md:31` (AC-13) still promises "a New project button that pre fills the client" unconditionally, while the Value sourcing row at `:139` now says none for an archived client. Amend the AC so `verify.md:19` and the AC read the same.
- ⚪ `src/projects/archive-project.test.ts:139`, `return config as CapturedConfig`; typing `state.configs` as `CapturedConfig[]` (its `name`, `requireRole` and `revalidate` are already what is pushed) removes the cast.

Carried over, unchanged:

- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:104-127`, `clientOptions` is spread into a fresh array and then `.push()`ed into, and `resolvedClientId` is a `let`. AGENTS.md says never mutate in place; a single expression building both from `filtered` reads the same and needs neither.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:113`, `getClient` runs for `clientParam === ""` too. `Boolean(clientParam)` would skip it and match the `hasFilter` test a few lines down.
- ⚪ `src/projects/queries.ts:88-105` and `page.tsx:91`, an unrecognised `status` such as `?status=bogus` is treated as the default by the query, carried into both toggle links, counted as a filter by `hasFilter`, and handed to a `<select defaultValue>` that matches no option. Harmless, but four places disagree on what an unknown value means.
- ⚪ `src/projects/queries.ts:128-139`, `let clientFilter` with an early return inside the `if`. A small pure helper returning `{ kind: "none" } | { kind: "unresolvable" } | { kind: "id", id }` would remove the mutable local.
- ⚪ `src/app/(agency)/(gated)/projects/[id]/page.tsx:25-38` and `edit/page.tsx:15-28`, `findProject` runs once in `generateMetadata` and once in the page, two identical reads per render. Wrapping it in React's `cache()` makes it one. The clients page has the same shape, so this is inherited, not new.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:162-187`, the archived view with nothing in it says "No projects match these filters" with a "Clear filters" link, where the clients page has a dedicated "No archived clients" state with copy explaining what would show there.
- ⚪ `src/projects/ui/projects-pagination.tsx:36-55`, `pageWindow` and the whole component are a near verbatim copy of `clients-pagination.tsx` with `q` swapped for `status` and `client`. A shared `pageWindow` under `src/ui/patterns` with a `hrefFor` callback would serve both.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:65` and `new/page.tsx:15`, `firstParam` is defined identically three times across the gated routes; `NO_RESULTS` is defined identically in `page.tsx:69` and `queries.ts:54`.
- ⚪ `src/app/(agency)/(gated)/projects/page.tsx:93-127`, `listProjects`, `listClientOptions` and `getClient` are three sequential awaits. On a one connection pool the database work serialises anyway, so the gain from `Promise.all` is small; take it or leave it.
- ⚪ `src/projects/ui/projects-filter-bar.tsx:138,148`, `aria-current="page"` is the more precise token than `"true"` for "this is the view you are on".
- ⚪ `src/app/design/gallery.tsx:511-524`, the "client picker" sample lists "Harbour Books (archived)", but the create picker never lists an archived client (AC-3); only the filter bar appends one. Under a "Project workflow" heading beside the move buttons, it reads as the create picker.
- ⚪ `src/app/design/gallery.tsx:496-510`, the move buttons are hardcoded labels; mapping `PROJECT_STATUSES` through `nextStatuses` would keep the gallery in step with `src/projects/status.ts`.
- ⚪ `src/app/design/gallery.tsx:514`, `aria-label={scoped("project-client-picker")}` gives the select the accessible name `light-project-client-picker`. Elsewhere `scoped()` feeds `id`, `name` and `htmlFor` and a `<Label>` supplies the name.
- ⚪ `src/projects/ui/projects-section.test.tsx:29-44`, the fixture is cast `as unknown as readonly ClientProjectRow[]`. A test only cast, but a small `row()` helper filling the remaining columns would keep the "no unchecked casts" rule intact in tests too.
- ⚪ `docs/scope/scope.md:221`, "Review it (fresh model)" is ticked while this review is what decides it; `docs/specs/0010-projects/verify.md:18`'s AC-12 step is likewise pre ticked with every other step blank.

## Strengths

- **The admin only test is the right kind of proof.** Rather than asserting a string on a config object and stopping, `archive-project.test.ts` runs the real `requireAdmin`/`requireStaff` from `@/db/tenant` on the captured config with a `member` context, so it proves both that the actions opt in and that the opt in has the effect the spec names, without duplicating the wrapper's own tests. It is the worked example spec 0010 says feature 16 should inherit.
- **The AC-9 fix is structural, not a patch.** Lifting the error into the group's state and keeping the group mounted while archived is the minimal change that makes the message and the refresh compatible; the spec row was rewritten to say why, and the tests replay the refresh as a rerender rather than trusting a `router.refresh` mock to mean anything.
- **The compare and set is proven at every layer.** `accessor.test.ts` asserts the rendered SQL is one flat `org_id AND id AND status` predicate; `tenancy.db.test.ts:542-604` proves against real PostgreSQL that the condition cannot reach another agency's row and that a miss writes nothing; `transition-project.test.ts:136-168` proves the action hands the accessor exactly `status = from AND archived_at IS NULL`.
- **`createProject` and `updateProject` are closed by construction.** Neither input schema has the field it must not accept (`status` and `clientId` respectively), and both test files smuggle the field into the raw input and assert it is dropped.
- **Foreign id indistinguishability holds everywhere**: `getProject`, `listProjectsForClient`, the transition follow up read, and both archive actions collapse missing, foreign and malformed into the same `undefined` or `not_found`, and the malformed case never reaches the driver.
- **The workflow rule is single source and exhaustive by type**: `MOVES` is a `Readonly<Record<ProjectStatus, ...>>`, so a new status fails the typecheck until it has moves, and `status.test.ts` walks all sixteen ordered pairs.

## Test coverage

Green and thorough: 144 files, 2380 tests (up 19 from the third pass), a test file beside every new module, axe in both themes on every component including the new archived client shapes, and the real database suite run here (19 tests, 42 seconds). Every acceptance criterion now has at least one automated assertion naming it, including the two that had none last pass (AC-12's server side refusal and AC-16's revalidation), and `e2e/projects.spec.ts` covers the signed out routes.

Remaining gaps, all small:

1. The conflict message's lifetime is tested across one refresh only (`project-status-actions.test.tsx:143-236`); the Minor above needs a second rerender to be visible.
2. `listProjects` still mocks `findMany` wholesale, so the `with: { client }` relation join is exercised only by the flattening test, not against a schema. A follow up in the database suite would close it.
3. `[id]/page.test.tsx:38-47` re implements `ProjectStatusActions`'s "nothing while archived" rule inside the mock. It is pinned from the other side by the component's own test, but if that rule ever moves the mock will not notice.
