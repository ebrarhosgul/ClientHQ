# Verify: projects · spec 0010 · updated 2026-09-13

_Steps derived from spec 0010 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Visit `/projects/new`, pick an active client, enter only a name, submit → redirects to `/projects/[id]` showing `planning`, no due date, no description → AC-1
- [ ] On `/projects/new`, submit a blank name, a 201 character name, a 5,001 character description, and `2026-02-30` as the due date, one at a time → each is refused inline with a field error and no project is created → AC-2
- [ ] Archive a client, then load `/projects/new` → its select never lists that client; submit `createProject` against its id directly (e.g. via the client's id copied into a request) → `not_found` → AC-3
- [ ] With a mix of statuses and one archived project, load `/projects` with no filters → every status but `delivered` shows, active only, ordered by due date (undated last) then name, 25 per page → AC-4
- [ ] Set `client=<not-a-uuid>` and `client=<another agency's client id>` on `/projects` → both show the empty state with the client select back on "All clients"; set `client=<this agency's archived client>` → the list filters correctly and the select shows that client marked "(archived)" → AC-5
- [ ] Open a project with a past due date, `in_progress` → the list, its detail page, and its client's Projects section all show the Overdue badge next to the due date; mark it `delivered`, then archive it → the badge disappears in both cases → AC-6, AC-17 (word + tint, never tint alone)
- [ ] Edit a project's name, description and due date, including clearing the due date → the detail page reflects the new values immediately; do the same on an archived project → still succeeds → AC-7
- [ ] From `planning`, click through `Start work` → `Send to review` → `Reopen` → `Send to review` → `Mark delivered` (confirm) → each screen shows exactly the buttons named in the spec's transition diagram, and `delivered` shows none → AC-8
- [ ] Open the same project's detail page in two tabs, move it forward in one, then click a now-stale button in the other → `conflict` naming the project's current status, the page refreshes to show the real buttons, and the row is unchanged → AC-9
- [ ] Archive a project mid-workflow (e.g. `in_review`) → no move buttons render; call `transitionProject` on it directly → `conflict` → AC-10
- [ ] As an admin, archive a project from each of the four statuses, then restore each one → status is unchanged by either action, and each is idempotent (repeat archive/restore with no error) → AC-11
- [x] As a member (non-admin), open a project's detail page → no Archive/Restore controls; call `archiveProject`/`restoreProject` directly → `forbidden` for both → AC-12
- [ ] Open a client with two active projects and one archived → the Projects section lists the two active ones newest first with status, due date, and any overdue badge, plus a New project link pre-filled with that client and an archived link to `/projects?client=<id>&archived=true&status=all` that shows the third → AC-13
- [ ] Archive a client with two active projects → the confirm dialog names "2 active projects"; confirm it → both projects are unaffected and still listed on `/projects` → AC-14
- [ ] As a second agency's staff member, attempt to open, edit, move, archive, and restore the first agency's project by id → `not_found`/`forbidden` on every path, indistinguishable from a missing id; visit `/projects` as a client contact → redirected before any data loads → AC-15
- [ ] After any create, edit, move, archive, or restore, confirm `/projects`, the project's own page, and its client's page all show the fresh state with no manual reload → AC-16
- [ ] Axe scan `/projects`, `/projects/new`, `/projects/[id]`, `/projects/[id]/edit`, and a client page's Projects section, in both themes, including their empty and error states → zero violations → AC-17
- [ ] Save the name/description/due date of the same project from two tabs within a second of each other → both succeed, the later tab's values persist, no error shown to either → AC-18

## Value sourcing edge cases

- [ ] A project due exactly today is not overdue; due yesterday (server's UTC day) is → confirms `isOverdue`'s boundary and that "today" is the UTC calendar day, not local time → status.ts, Value sourcing
- [ ] `status` unset with `archived=false` shows every status but `delivered`; `status` unset with `archived=true` shows every status → confirms the "open" vs "all" default split → Value sourcing
- [ ] Changing any one of status, client, or archived while on page 3 of a list lands back on page 1 → Value sourcing, AC-4
- [ ] The client picker on `/projects/new` pre-selects from `?client=` only when that id resolves to one of this agency's active clients → Value sourcing, AC-3

## Commands

- [ ] `corepack pnpm typecheck` → passes
- [ ] `corepack pnpm lint` → passes
- [ ] `corepack pnpm format:check` → passes
- [ ] `corepack pnpm vitest run src/projects src/clients src/db/tenant src/app` → passes (status/schema unit tests, action tests, the compare-and-set accessor and real-Postgres tenancy tests, the client and project page tests)

## Acceptance-criteria coverage

- AC-1 create defaults to `planning` · AC-2 input caps and the impossible-date refusal · AC-3 the active-client gate on create · AC-4 the default list, order, and paging · AC-5 the unresolvable/archived client filter · AC-6 every displayed field plus the overdue badge · AC-7 edit including a cleared due date · AC-8 the four allowed moves and nothing else · AC-9 the compare-and-set conflict · AC-10 an archived project's frozen status · AC-11 admin-only idempotent archive/restore · AC-12 a member's refusal and hidden controls · AC-13 the client page's Projects section · AC-14 the archive-client confirm's project count · AC-15 tenant isolation on every path · AC-16 revalidation of all three surfaces · AC-17 accessibility across every new screen and state · AC-18 concurrent edits both landing
