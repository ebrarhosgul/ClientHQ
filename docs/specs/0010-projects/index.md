# 0010. Projects

**Date**: 2026-09-13
**Status**: In Progress

## Summary

This spec is the build plan for projects, the unit of work an agency delivers to a client: create one under a client, see it in an agency wide list and on the client's page, move it through planning, in progress, in review and delivered, set a due date, edit it, and archive it when it is closed. The database table already exists from spec 0002 with no changes needed; this spec settles the workflow rules (which status moves are allowed, what archiving freezes, who may archive) and builds the screens and Server Actions (functions that run on the server when a form is submitted) on top, on the same pattern as client records (spec 0006). Two things are new for this codebase: a status move is a compare and set (the write only lands if the status is still what the button was rendered from, so two people cannot skip a stage), and archive and restore are the first admin only actions.

## Requirements

**User stories**:
- As an agency staff member, I want to create a project under one of my clients so the work has a home for its status, due date, and later its files and invoices.
- As an agency staff member, I want to see every open project across all my clients, soonest due first, so I know what to work on.
- As an agency staff member, I want to see a client's projects on that client's page so I can find their work without leaving it.
- As an agency staff member, I want to move a project through its stages with one click, and be stopped from skipping a stage or undoing a delivery by mistake.
- As an agency staff member, I want to see at a glance which projects are overdue.
- As an agency admin, I want to archive a closed project so the open list stays focused, and bring it back if that changes.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A signed in staff member can create a project by choosing one of the agency's active clients and giving a name; description and due date are optional; the new project always starts in `planning`, status is never chosen at creation.
- **AC-2**: The name cannot be blank or whitespace only and is capped at 200 characters; the description is capped at 5,000 characters and a blank description is stored as absent; the due date, when given, must be a valid calendar day (`YYYY-MM-DD`); any invalid input is refused with an inline error and no row is created or changed.
- **AC-3**: Creating a project under an archived client, a client that belongs to another agency, or a client id that does not exist is refused at the action; the client picker only ever lists the agency's active clients.
- **AC-4**: `/projects` shows the agency's active (non archived) projects in every status except `delivered` by default, ordered by due date soonest first, projects with no due date last, then by name, in pages of 25; the status filter (one status, `open`, or `all`), the client filter, the active or archived toggle, and the page number all live in the URL; when the archived toggle is on and no status is given, every status shows.
- **AC-5**: A `client` filter naming a client that is not resolvable in this agency (another agency's, nonexistent, or not a uuid) shows an empty list with the client control cleared, never an error page; a filter naming one of this agency's archived clients works normally and the control shows that client, marked archived.
- **AC-6**: Opening a project shows its name, its client as a link to the client page, its status, its due date, its description, whether it is archived, and an overdue badge when its due date is before today and it is neither `delivered` nor archived; the page also carries an empty, labelled Deliverables section reserved for feature 12.
- **AC-7**: A staff member can edit the name, description, and due date (including clearing the due date) of any project, active or archived, and the new values show immediately; the client cannot be changed after creation.
- **AC-8**: Status moves only along `planning` → `in_progress` → `in_review` → `delivered`, plus `in_review` → `in_progress`; `delivered` is final; the detail page renders exactly one button per move valid from the current status, the move to `delivered` asks for confirmation, and any other requested move is refused.
- **AC-9**: A status move is a compare and set: the write lands only if the project's status is still the one the button was rendered from; otherwise the action returns `conflict` with a message naming the status the project now has, writes nothing, and the move button refreshes the page so it shows the fresh status and its buttons.
- **AC-10**: An archived project's status cannot change: the detail page renders no move buttons for it, and a move requested directly is refused with `conflict`.
- **AC-11**: An agency admin can archive a project from any status (behind a confirm dialog) and restore an archived one; archiving keeps the project's status; both actions are idempotent, succeeding with no error when the project is already in the target state.
- **AC-12**: An agency member (not admin) never sees the archive or restore controls, and a member calling either action directly is refused with `forbidden`.
- **AC-13**: The client page (`/clients/[id]`) shows a Projects section listing that client's active projects newest first with status, due date, and the overdue badge, a New project button that pre fills the client, a link to `/projects` filtered to that client's archived projects, and an empty state when the client has no active project.
- **AC-14**: Archiving a client whose active projects number one or more shows that count in the confirm dialog; the client can still be archived, and its projects stay active and listed on `/projects`.
- **AC-15**: Every project read and write goes through the tenant scoping data access layer, scoped to the acting agency; a staff member from another agency cannot see, open, edit, move, archive, or restore this agency's project, and a direct link to it behaves exactly like a project that does not exist; a client contact visiting any `/projects` page is redirected before any data loads, and a client contact context calling any project action directly is refused.
- **AC-16**: Every project write revalidates `/projects`, `/projects/[id]`, and `/clients/[id]`, so the list, the detail page, and the client page's Projects section never show a stale status.
- **AC-17**: The empty state (no projects yet, or no matches for the current filters), the error state (a failed read), and every screen this feature adds pass WCAG 2.2 AA in both themes, using the existing empty and error state patterns.
- **AC-18**: When two staff members save the name, description, or due date of the same project close together, both saves succeed and the later one's values remain, with no error shown to either.

## Decision

**Chosen option**: Option 2: The client records pattern (URL driven server components for the lists, Server Actions for every write, through the tenant layer), plus a compare and set status move and admin only archive.

This reuses the pattern the rest of the app runs on with no new library, no migration, and no new environment variable; the only infrastructure change is one optional extra condition on the tenant layer's `update`, so a move can say "only if the status is still X".

**Implementation skills**: `zod` (`.agents/skills/zod/`) · `shadcn` (`.agents/skills/shadcn/`) · `tailwind` (`.agents/skills/tailwind/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`)

## Feature design

**Data model sketch**:

The `projects` table already exists (spec 0002). No column, index, or constraint changes; this feature adds rules on top of it, and no migration lands in the build plan.

| Field | Type | Nullable | Rule this feature adds |
|---|---|---|---|
| id | uuid (pk) | no | existing |
| org_id | uuid (fk to organizations, cascade) | no | existing, tenant scope, always from context |
| client_id | uuid (fk to clients, restrict) | no | must be an active client of the acting agency at creation; never changes afterwards |
| name | text | no | trimmed, 1 to 200 characters |
| description | text | yes | trimmed, up to 5,000 characters; a blank value is stored as null |
| status | text, one of `planning`, `in_progress`, `in_review`, `delivered` | no | defaults to `planning`; moves only along the transitions below; frozen while archived |
| due_date | date (a calendar day, string `YYYY-MM-DD`) | yes | any day, past allowed; "overdue" is derived at read time, never stored |
| archived_at | timestamp with time zone | yes | null means active; set from any status, the status is kept |
| created_at, updated_at | timestamp with time zone | no | existing |

Every cap is enforced by the Zod schema, not a database constraint, matching `clients`.

Relationships, unchanged: `clients` to `projects` is one to many (a project belongs to exactly one client); `projects` to `deliverables` is one to many (feature 12, not built here). The existing indexes `(org_id, client_id)`, `(org_id, status)`, and `(org_id, archived_at)` cover this feature's filters. The due date sort runs over one agency's already filtered rows, loaded and paged in memory exactly as `listClients` does, so no new index.

**State transitions**:

Two independent dimensions, workflow status and archived, as the schema intends.

Workflow status (staff triggered, from the detail page):

```
planning ──"Start work"──▶ in_progress ──"Send to review"──▶ in_review ──"Mark delivered" (confirm)──▶ delivered
                                ▲                                  │
                                └────────────"Reopen"──────────────┘
```

`delivered` is final. No other move exists. Every move is a compare and set on the status it was rendered from.

Archived (admin triggered, from the detail page): `active` → `archived` ("Archive", confirm, allowed from any status) and `archived` → `active` ("Restore", no confirm). Archiving keeps the status; while archived, no workflow move is allowed. Name, description, and due date stay editable while archived, like clients.

There is no delete transition; this feature never hard deletes a project row.

**API surface**:

All five Server Actions are `withTenantAction` wrappers returning the project's existing `Result<TData>` (`src/db/tenant/errors.ts`): `{ ok: true, data }` or `{ ok: false, error: { code, message, fieldErrors? } }`. The codes used here all exist already: `validation` (with `fieldErrors`), `not_found`, `conflict`, `forbidden`, plus `subscription_inactive` from the access gate (spec 0008) that the wrapper applies to every write.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/projects` | Server Component read | URL params: `status` (`open` default, `all`, or one status), `client` (uuid), `archived` (bool, default false), `page` (default 1) | a page of 25: id, name, client name, status, due date, overdue flag, archived_at; the filter controls; page count | requireStaff | none; an unauthenticated visitor is redirected to sign in by the proxy, a client contact is redirected to `/onboarding` |
| `/projects/new` | Server Component read + form | optional URL param `client` (uuid) to pre select | the create form with a native select of the agency's active clients ordered by name | requireStaff | none; an unresolvable `client` param leaves the select on its placeholder |
| `createProject` | Server Action | clientId (uuid, required), name (required), description (optional), dueDate (optional `YYYY-MM-DD`) | `Result<{ id }>`; on success redirects to `/projects/[id]` | requireStaff | `validation` (blank name, over a cap, bad date, malformed client id), `not_found` (client not active in this agency) |
| `/projects/[id]` | Server Component read | id (route param) | every field, the client name and link, overdue flag, the move buttons valid now, edit link, archive or restore (admin only), the Deliverables placeholder | requireStaff | not found (missing id, another agency's id, non uuid); a route level `error.tsx` handles an unexpected read failure |
| `/projects/[id]/edit` | Server Component read + form | id (route param) | name, description, due date pre filled; the client shown read only | requireStaff | not found |
| `updateProject` | Server Action | id (required), name (required), description (optional), dueDate (optional, blank clears it) | `Result<{ id }>`; on success redirects to `/projects/[id]` | requireStaff | `validation`, `not_found` |
| `transitionProject` | Server Action | id (required), from (status, required), to (status, required) | `Result<{ status }>`; stays on `/projects/[id]` | requireStaff | `validation` (`from` → `to` is not an allowed move), `not_found`, `conflict` (the status is no longer `from`, or the project is archived) |
| `archiveProject` | Server Action | id (required) | `Result<{ archivedAt: Date }>`; stays on `/projects/[id]`; no-op success if already archived | requireRole admin | `forbidden` (a member), `not_found` |
| `restoreProject` | Server Action | id (required) | `Result<{ archivedAt: null }>`; stays on `/projects/[id]`; no-op success if already active | requireRole admin | `forbidden` (a member), `not_found` |
| `/clients/[id]` Projects section | Server Component read (added to the existing page) | client id (route param) | that client's active projects newest first: id, name, status, due date, overdue flag; the New project link; the archived link | requireStaff | none beyond the page's own not found |
| `archiveClient` confirm | existing dialog (spec 0006), amended | the client's active project count, passed as a prop | the count in the dialog copy | unchanged | unchanged |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| every read | which agency's projects to show | tenant context (the signed in session), never a URL or form value |
| `/projects` read | which status set to show | the `status` URL param: `open` means every status except `delivered`; `all` means every status; one of the four means that status only; missing or unknown means `open` when `archived` is false and `all` when `archived` is true (an archived list is a record, not a work list) |
| `/projects` read | which client to narrow to | the `client` URL param, parsed as a uuid; a value that is not a uuid is treated as unresolvable (empty list, control cleared) without touching the database |
| `/projects` read | whether the client control shows an archived client | the filtered client is looked up through the tenant layer; if found and archived, it is appended to the select as one extra option labelled "(archived)" |
| `/projects` read | the row order | `due_date` ascending (PostgreSQL puts nulls last on ascending by default), then `name`, then `id` |
| `/projects` read | which page, and what an out of range page shows | the `page` URL param, clamped to 1 as `listClients` does; a filter change always resets `page` to 1 |
| `/projects` and `/projects/[id]` reads, the client section | the overdue flag | derived, never stored: `due_date` is present, `due_date < today`, status is not `delivered`, and the project is not archived |
| the same reads | "today" for the overdue comparison | the server clock's UTC calendar day (`new Date().toISOString().slice(0, 10)`), passed into the pure helper so tests can fix it; no timezone column exists, and this rule is the one feature 18's overdue sweep should reuse |
| `/projects/new` | the clients in the picker | a new `listClientOptions(ctx)` read in `src/clients/queries.ts`: id and name of every active client of the agency ordered by name then id, no paging |
| `/projects/new` | which client is pre selected | the `client` URL param when it matches one option; otherwise the placeholder |
| `createProject` | the `org_id` stamped on the row | tenant context, never client supplied |
| `createProject` | whether the chosen client is allowed | a tenant scoped `findById` on `clients` inside the action: missing (any reason) or `archived_at` set means `not_found`, message "Choose an active client" |
| `createProject` | the initial status | the column default `planning`; the input schema has no status field |
| `createProject` / `updateProject` | whether a due date is a real day | the Zod schema: the string must match `^\d{4}-\d{2}-\d{2}$`, and parsing it with `Date.UTC` then formatting back must give the same string, so `2026-02-30` is refused with the field error "Enter a real date" |
| every read that shows a status | the status label a person sees | `PROJECT_STATUS_PRESENTATION` in `src/ui/patterns/status-chip.tsx` (spec 0004): Planning, In progress, In review, Delivered; the chip, the list, the client section, and the `conflict` message all read it |
| `createProject` / `updateProject` | a blank optional field | preprocessed from `""` (or whitespace) to `undefined` before its own check, then written as null, exactly as `clients` does |
| `updateProject` | a cleared due date | a blank `dueDate` on the edit form writes null; the schema distinguishes "absent" from "blank" only for create, where both mean no date |
| `/projects/[id]` | which move buttons render | `nextStatuses(status)` from the pure status module, empty when archived |
| `/projects/[id]` | the `from` a move button submits | the status the page rendered, as a hidden form value, so the action compares against what the person saw |
| `transitionProject` | whether `from` → `to` is allowed | `canTransition(from, to)` from the pure status module, checked before any read |
| `transitionProject` | whether the write lands | one `UPDATE ... SET status = to WHERE id = ? AND org_id = ? AND status = from AND archived_at IS NULL`, through the tenant layer's `update(table, id, patch, { where })`, the new optional condition; `undefined` back means `conflict` |
| `transitionProject` | the `conflict` message | a follow up tenant scoped `findById`: "This project was already moved to <current status label>" when the status differs, "This project is archived" when `archived_at` is set, `not_found` when the row is gone |
| the move button | what refreshes the page after a move | the button calls `router.refresh()` after the action returns, on success and on `conflict` alike, exactly as `archive-client-button.tsx` does; the action's `revalidate` config runs on success only, because `withTenantAction` skips it when the handler throws |
| the deliver confirm | the dialog copy | title "Mark this project as delivered?", body "Delivered is final. You can archive it later, but it cannot go back to review.", confirm button "Mark delivered" |
| the archive confirm | the dialog copy | title "Archive this project?", body "It keeps its status and leaves the open list. An admin can restore it later.", confirm button "Archive" |
| `/projects/[id]` | whether archive and restore render | `ctx.role === "admin"` from the tenant context (the Clerk session claim, spec 0005), never the `memberships` mirror |
| `archiveProject` / `restoreProject` | the refusal for a member | `withTenantAction` with `requireRole: "admin"`, which refuses with `forbidden` before the handler runs |
| `archiveProject` / `restoreProject` | the `archived_at` timestamp | the server clock when the action runs |
| `/clients/[id]` Projects section | the rows | a new `listProjectsForClient(ctx, clientId)` read: `client_id` matches, `archived_at` is null, ordered by `created_at` descending then `id`, no paging |
| `/clients/[id]` Projects section | the New project link target | `/projects/new?client=<id>` |
| `/clients/[id]` Projects section | the archived link target | `/projects?client=<id>&archived=true&status=all` |
| `archiveClient` confirm | the active project count | a new `countActiveProjects(ctx, clientId)` read, run by the client page and passed to `ArchiveClientButton` as a prop; zero shows the existing copy unchanged |
| every write | what renders again afterwards | the action's `revalidate` config: `/projects`, `/projects/[id]` (page), `/clients/[id]` (page) |
| any `[id]` route for a foreign or missing id | not found rather than forbidden | the tenant scoped `findById` returning nothing either way, so a prober cannot tell a missing id from another agency's project |

**Key invariants**:

- `org_id` is always set from the tenant context; it is never read from a form field.
- `client_id` always names a client of the same `org_id`, active at the moment of creation, and never changes afterwards; no action accepts a new `client_id` for an existing project.
- `name`, trimmed, is never empty.
- `status` only ever changes along the four allowed moves, and only while `archived_at` is null; the transition table lives in one pure module (`src/projects/status.ts`) that both the page (which buttons) and the action (which moves) read.
- A status write is conditional on the status it was rendered from; a stale move never lands.
- `archived_at` is either null or a timestamp; archiving never touches `status`.
- Archive and restore are idempotent; a repeat succeeds with no error and no write.
- "Overdue" is computed at read time from `due_date`, `status`, `archived_at`, and the UTC day; nothing stores it.
- A project row is never deleted by this feature.

**Security model**:

Every read and every action requires a staff context (`requireStaff`); a client contact resolves to a contact context and is refused, and the proxy redirects a contact away from `/projects` before any data loads. Create, list, view, edit, and status moves are open to every staff member, admin or member. Archive and restore are admin only, enforced by `withTenantAction`'s `requireRole: "admin"`, which reads the role from the Clerk session claim carried on the context (spec 0005), not from the `memberships` mirror; the detail page hides the two controls for a member using the same `ctx.role`. This is the first admin only action in the codebase; feature 16 (team members and roles) inherits the pattern rather than inventing one. Every query is scoped to `ctx.orgId` through `tenantDb()`; there is no path to another agency's rows, and a foreign id is indistinguishable from a missing one. Every write is also behind the subscription access gate (spec 0008), so a locked agency can read projects but not change them. No compliance scope: a project holds a name, a description, and a date, nothing regulated.

**Critical test scenarios** (each maps to an acceptance criterion above):
- Happy path: create a project under an active client from `/projects/new`, see it on `/projects` in `planning` and in the client's Projects section, open it, start work, send to review, reopen, send to review again, mark delivered with confirmation, see it drop out of the default list and appear under `status=delivered`; as an admin, archive it and restore it. Verifies **AC-1**, **AC-4**, **AC-6**, **AC-8**, **AC-11**, **AC-13**.
- Failure case, stale move: render the detail page for a `planning` project, move it to `in_progress` through a second context, then submit the first page's "Start work"; the action returns `conflict` naming `in_progress`, the row is unchanged, and the page shows "Send to review" instead. Verifies **AC-9**.
- Failure case, illegal move: `transitionProject(id, "planning", "delivered")` and `transitionProject(id, "delivered", "in_review")` are both refused with `validation` and write nothing; a move on an archived project is refused with `conflict`. Verifies **AC-8**, **AC-10**.
- Failure case, bad client: `createProject` with an archived client id, another agency's client id, and a random uuid all return `not_found` with no row written; the picker on `/projects/new` never lists the archived one. Verifies **AC-3**.
- Auth and permission: a member sees no archive or restore control and gets `forbidden` calling either action directly; a second agency's staff member given a direct link gets not found on `/projects/[id]` and `not_found` from every action; a client contact visiting `/projects` is redirected. Verifies **AC-12**, **AC-15**.
- List filters and edge cases: the default list omits `delivered` and archived projects and orders a dated project before an undated one; `client=<non uuid>` and `client=<foreign uuid>` both render the empty state with the select on its placeholder; `client=<archived client>` filters and shows the "(archived)" option; changing a filter on page 3 lands on page 1. Verifies **AC-4**, **AC-5**.
- Client page: a client with two active projects and one archived shows the two, newest first, with an archived link that lands on `/projects` showing the third; archiving that client shows "2 active projects" in the confirm and, after archiving, both projects are still on `/projects`. Verifies **AC-13**, **AC-14**.
- Overdue and edit: a project due yesterday (UTC) in `in_review` shows the overdue badge on the list, the detail page, and the client section; the same project marked `delivered`, or archived, does not; editing it to clear the due date removes the badge; two edits seconds apart both succeed and the later values persist. Verifies **AC-6**, **AC-7**, **AC-18**.
- Empty, error, and accessibility: a fresh agency sees the empty state on `/projects` and in a client's Projects section; a forced read failure shows the error state; the create form, the detail page with its move buttons and confirm dialogs, and the list with its filters pass an axe scan in both themes. Verifies **AC-16**, **AC-17**.

## Build plan

Ordered for Tracer Bullet: the thinnest end to end thread (a real create landing on a real list and a real detail page, tenant scoped) comes first, then each later task thickens one part of it. No migration: the data model is already in place.

1. The pure status module `src/projects/status.ts`: the `PROJECT_STATUSES` order, `nextStatuses(status, archived)` (the moves valid now, empty when archived), `canTransition(from, to)`, the button label and confirm flag per move, and `isOverdue(dueDate, status, archivedAt, todayUtc)`; unit tests over every pair of statuses and the overdue boundary (due today is not overdue, due yesterday is). Satisfies **AC-6**, **AC-8**, **AC-10**.
2. The tenant layer's `update` gains a fourth optional argument, `options?: { readonly where?: SQL }`, whose condition is combined with `AND` inside the existing `scope()` call so the org and id predicates can never be dropped, letting a caller make a write conditional; a database test proves a non matching condition updates nothing and returns `undefined`, and that the org scope cannot be widened by it. Satisfies **AC-9**.
3. The Zod input schemas in `src/projects/schema.ts`: `projectId`, create (clientId uuid, name trimmed 1 to 200, description trimmed up to 5,000 with blank to `undefined`, dueDate optional, matching `^\d{4}-\d{2}-\d{2}$` and surviving a `Date.UTC` round trip so an impossible day is refused), update (same without clientId), and transition (id, from, to, each a `PROJECT_STATUSES` member); unit tests. Satisfies **AC-2**.
4. One thread end to end: `listClientOptions` in `src/clients/queries.ts` (active clients, name then id); `createProject` as a `withTenantAction` that checks the client is active in this agency and redirects to the new project; `/projects/new` with the native client select (pre selected from `?client=` when it resolves); `/projects` replacing the reserved placeholder with a minimal list of active, non delivered projects in due date order, page size 25; `/projects/[id]` showing the fields, the client link, the status chip, and the overdue badge, with a route level `error.tsx`; a database test proving a project created by one agency is invisible to another on every read, and the gated route test updated for the real page. Satisfies **AC-1**, **AC-3**, **AC-4**, **AC-6**, **AC-15**, **AC-16**.
5. Status moves: `transitionProject` (allowed move check, then the conditional update, then the `conflict` message from a fresh read), one move button component that submits the rendered `from` as a hidden value, shows the action error inline, and calls `router.refresh()` after every result, the confirm dialog on "Mark delivered", and the detail page rendering exactly the buttons `nextStatuses` returns; a database test for the stale move race. Satisfies **AC-8**, **AC-9**, **AC-10**.
6. Edit: `updateProject` and `/projects/[id]/edit` with the client shown read only and a clearable due date; the concurrent edit test mirrors spec 0006's. Satisfies **AC-7**, **AC-18**.
7. Archive and restore, admin only: `archiveProject` and `restoreProject` with `requireRole: "admin"`, both idempotent, the confirm dialog on archive, the two buttons rendered only when `ctx.role === "admin"`, and no move buttons on an archived project; tests for the member refusal and the hidden controls. Satisfies **AC-10**, **AC-11**, **AC-12**.
8. Thicken the list: the status, client, and archived controls driven by URL params, page links, the page reset on any filter change, the unresolvable client rule, and the appended "(archived)" client option. Satisfies **AC-4**, **AC-5**.
9. The client page: `listProjectsForClient` and `countActiveProjects` in `src/projects/queries.ts`, the Projects section on `/clients/[id]` with its New project and archived links and its empty state, and `ArchiveClientButton` taking the active project count for its confirm copy. Satisfies **AC-13**, **AC-14**.
10. Empty state, error state, the Deliverables placeholder section on the detail page, and an accessibility pass (axe, both themes) across `/projects`, `/projects/new`, `/projects/[id]`, `/projects/[id]/edit`, and the client page section; add the move button row, the overdue badge, and the client picker to `/design` in every state. Satisfies **AC-6**, **AC-17**.

## Consequences

**Positive**:
- The workflow rule lives in one pure module read by both the page and the action, so the buttons a person sees and the moves the server allows cannot drift apart.
- The compare and set on status is the first write in the codebase that cannot be raced into a wrong state, and the conditional `update` it adds to the tenant layer is reusable by invoices (feature 13), whose issue and pay moves need the same protection.
- Archive and restore establish the admin only action pattern on the existing `requireRole` option, so feature 16 has a worked example rather than a blank page.
- No migration, no new dependency, no new environment variable.

**Negative / tradeoffs**:
- "Today" is the UTC calendar day, so an agency far from UTC sees a project flip to overdue a few hours early or late. Exact per agency timing needs a timezone column and a settings field that this spec deliberately does not add.
- Last write wins on name, description, and due date, as with clients; only the status move is protected.
- `delivered` is final. A project delivered by mistake can only be archived and recreated, not reopened.
- A native select for the client picker gets long for an agency with hundreds of clients; a searchable combobox is a later swap.
- The list loads every matching row for the agency and pages in memory, as `listClients` does; fine at the row counts expected, but it is the same scaling note spec 0006 carries.
- The active project count in the archive client confirm is read when the client page loads, so a project created or archived between that load and the click is not reflected; the count is informational copy, never a gate, so nothing is refused or lost.

**Neutral**:
- The tenant layer's `update` signature grows one optional parameter; every existing caller is unchanged.
- `ArchiveClientButton` gains a required count prop, so the client page and its tests change slightly.
- The reserved `/projects` placeholder and its route test are replaced, as that file says they would be.
- The detail page's empty Deliverables section is the only piece of UI here for a feature not yet built.

## Follow-up

- [ ] Feature 18 (daily cron sweeps) should reuse this spec's "today is the UTC calendar day" rule for marking invoices overdue, so the two overdue notions agree.
- [ ] If an agency asks for exact local overdue timing, add a timezone column to `organizations` and a settings field, then swap the UTC day for the agency's day in `isOverdue`; the helper already takes today as a parameter.
- [ ] Feature 13 (invoices) should use the conditional `update` added here for its issue and pay moves.
- [ ] `/sync` should note the conditional `update` in `src/db/AGENTS.md` once it lands, since spec 0003 documents the accessor's surface.
- [ ] Spec 0006's Follow-up about archiving a client with projects is settled here (a count in the confirm, never a block); mark it done when this feature ships.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
