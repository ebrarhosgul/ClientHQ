# 0006. Client records

**Date**: 2026-09-10
**Status**: In Progress

## Summary

This spec is the build plan for the first real screen an agency uses day to day: adding a client company, listing them, opening one, editing it, and archiving it when the relationship ends. The database table for this already exists from an earlier spec; this one adds a few more fields to it and builds the pages and actions on top. It closes the walking skeleton: the first full loop of real sign in, real tenant scoped data, and a real screen, all working end to end.

## Requirements

**User stories**:
- As an agency staff member, I want to add a new client company so I can start tracking work for them.
- As an agency staff member, I want to see a list of my agency's clients so I can find the one I need.
- As an agency staff member, I want to search my client list by name so I can find a client quickly once there are many.
- As an agency staff member, I want to open a client and see everything on file for them.
- As an agency staff member, I want to edit a client's details when something changes.
- As an agency staff member, I want to archive a client I no longer work with, so my active list stays focused, and bring them back if that changes.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: A signed in staff member can create a client with just a name; company email, phone, industry, billing address, and notes are all optional.
- **AC-2**: A client's name cannot be blank or whitespace only.
- **AC-3**: Company email, when provided, must be a valid email format; an invalid value is refused with an inline error and no row is created or changed.
- **AC-4**: The client list shows active (non archived) clients by default, in pages of 25 ordered by name, with a control to switch to viewing archived clients instead.
- **AC-5**: The client list can be narrowed by a name search, honoring whichever of active or archived is currently shown.
- **AC-6**: Opening a client shows every one of its fields and whether it is archived.
- **AC-7**: A signed in staff member can edit any field on a client, active or archived, and the new values show immediately on the detail page.
- **AC-8**: Archiving a client asks for confirmation, then sets its archived timestamp and removes it from the default list, without deleting the row; archiving a client that is already archived succeeds with no error (it is idempotent).
- **AC-9**: Restoring an archived client clears its archived timestamp and returns it to the default list; restoring a client that is already active succeeds with no error (it is idempotent).
- **AC-10**: Every client read and write goes through the tenant scoping data access layer, scoped to the acting agency.
- **AC-11**: A staff member from a different agency cannot see, open, edit, archive, or restore another agency's client; a direct link to it behaves exactly like a client that does not exist.
- **AC-12**: A client contact (a portal login, not agency staff) never reaches a client records screen or action: visiting any `/clients` page redirects them (the proxy has no organization claim to find), and a client contact context reaching one of the four Server Actions directly is refused by `requireStaff`.
- **AC-13**: The empty state (no clients yet, or a search with no matches) and the error state (a failed read) both use the existing empty and error state patterns and pass WCAG 2.2 AA.
- **AC-14**: When two staff members save the same client close together, both saves succeed and the later one's values are what remain, with no error shown to either.

## Decision

**Chosen option**: Option 1: URL driven server components for the list (page number and search live in the URL), Server Actions for every write, both reading and writing through the existing tenant scoping layer.

This reuses the pattern the rest of the app already runs on, with no new library and no new client side state to manage.

**Implementation skills**: `zod` (`.agents/skills/zod/`) · `shadcn` (`.agents/skills/shadcn/`) · `tailwind` (`.agents/skills/tailwind/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`)

## Feature design

**Data model sketch**:

The `clients` table already exists (spec 0002). This spec amends it with new columns; nothing else in the schema changes.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | uuid (pk) | no | existing |
| org_id | uuid (fk to organizations, cascade) | no | existing, tenant scope |
| name | text | no | existing |
| company_email | text | yes | existing, validated as an email when present, stored lowercase (a new CHECK constraint mirrors `client_contacts.email`'s lowercase rule) and capped at 320 characters |
| notes | text | yes | existing, capped at 5,000 characters |
| archived_at | timestamp | yes | existing, null means active |
| phone | text | yes | new, free text, no format enforced, trimmed and capped at 50 characters |
| industry | text | yes | new, free text, no fixed list, capped at 200 characters |
| billing_address_line1 | text | yes | new, capped at 200 characters |
| billing_address_line2 | text | yes | new, capped at 200 characters |
| billing_city | text | yes | new, capped at 200 characters |
| billing_region | text | yes | new, state or province, capped at 200 characters |
| billing_postal_code | text | yes | new, capped at 20 characters |
| billing_country | text | yes | new, free text, not a fixed country list, capped at 200 characters |
| created_at, updated_at | timestamp | no | existing |

`name` is capped at 200 characters. Every cap is enforced by the Zod schema, not a database constraint (consistent with `notes`, which has none today).

Relationships, unchanged by this feature: `clients` to `client_contacts` is one to many (feature 10 owns contacts and invitations, out of scope here); `clients` to `projects` and `clients` to `invoices` are one to many, both features not yet built (11 and 13).

Rules: name is required and cannot be blank after trimming; every other field is optional; no uniqueness constraint on name (two clients can share a name); the billing address has no cross field requirement, a client can have just a city and nothing else.

**State transitions**:

A client has exactly two states: active (`archived_at` is null) and archived (`archived_at` holds a timestamp).

`active` → `archived`: the archive action, staff triggered, behind a confirm dialog.
`archived` → `active`: the restore action, staff triggered, no confirm needed.

There is no delete transition; this feature never hard deletes a client row.

**API surface**:

All four Server Actions return the project's existing `Result<TData>` (from `src/db/tenant/errors.ts`): `{ ok: true, data }` on success, or `{ ok: false, error: { code, message, fieldErrors? } }` on failure, where `code` is one of the existing `ACTION_ERROR_CODES`. A `validation` code carries `fieldErrors` (Zod's flattened shape) for the form to show inline; no action here needs any code beyond `validation`, `not_found`, and `forbidden`, all of which already exist.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/clients` | Server Component read | `page` (default 1), `q` (search, optional), `archived` (bool, default false), all URL search params | a page of 25 clients ordered by name then id: id, name, company email, phone, archived_at | requireStaff | none; an unauthenticated visitor is redirected to sign in by the proxy, and a client contact is redirected to `/onboarding` |
| `/clients/new` | Server Component read + form | none | an empty create form | requireStaff | none |
| `createClient` | Server Action | name (required), company_email, phone, industry, notes, billing address fields (all optional) | `Result<{ id: string }>`; on success, redirects to `/clients/[id]` | requireStaff | `validation` (bad email format, blank name, a field over its length cap) |
| `/clients/[id]` | Server Component read | id (route param) | every field on the client, plus its archived state | requireStaff | not found (missing id, or another agency's id; a route level `error.tsx` handles an unexpected read failure) |
| `/clients/[id]/edit` | Server Component read + form | id (route param) | the client's current values, pre-filled | requireStaff | not found |
| `updateClient` | Server Action | id (required), same fields as `createClient` | `Result<{ id: string }>`; on success, redirects to `/clients/[id]` | requireStaff | `validation`, `not_found` |
| `archiveClient` | Server Action | id (required) | `Result<{ archivedAt: Date }>`; stays on `/clients/[id]`; a no-op success if already archived | requireStaff | `not_found` |
| `restoreClient` | Server Action | id (required) | `Result<{ archivedAt: null }>`; stays on `/clients/[id]`; a no-op success if already active | requireStaff | `not_found` |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| `/clients` read | which agency's clients to show | tenant context (the signed in session), never a URL or form value |
| `/clients` read | which page and search term to apply | URL search params (`page`, `q`, `archived`) |
| `/clients` read | which rows match the search | `ILIKE '%' || trim(q) || '%'` on `name` only, case insensitive; an empty or missing `q` matches everything |
| `/clients` read | the page shown after `q` or `archived` changes | the list's own link/form always sets `page=1` when either changes, so a filter change never leaves a stale page number behind |
| `/clients` read | what an out of range `page` (0, negative, non numeric, or past the last page) shows | clamped to page 1 server side, never a 404 or a crash |
| `createClient` / `updateClient` | the `org_id` stamped on the row | tenant context, never client supplied |
| `createClient` / `updateClient` | whether the email is valid | the Zod schema's email check at the action boundary, applied only when the field is non blank |
| `createClient` / `updateClient` | whether a blank optional field is stored as absent or as an error | every optional field is preprocessed from `""` (or whitespace only) to `undefined` before validation runs, so an untouched form field never fails the email check |
| `createClient` / `updateClient` | `company_email`'s stored casing | lowercased before it is written, mirroring `client_contacts.email` |
| `archiveClient` / `restoreClient` | the `archived_at` timestamp | the server clock at the moment the action runs, never a client supplied date |
| every write action | what re-renders immediately after it | `revalidatePath("/clients")` and `revalidatePath("/clients/[id]", "page")`, called by the action itself |
| `/clients/[id]` for a foreign agency's id | "not found" rather than "forbidden" | the tenant scoped find returning nothing either way, so a prober cannot tell a missing id from someone else's client |

**Key invariants**:

- `org_id` is always set from the tenant context; it is never read from a form field or the client id's own row.
- `name`, trimmed, is never empty.
- `company_email`, when present, is a valid email format.
- `archived_at` is either null or a timestamp; there is no third state.
- A client row is never deleted by this feature, only archived.
- Archiving or restoring a client already in that state succeeds with no error; both actions are idempotent.
- The name search cannot use `clients_org_id_name_idx` (a substring match, not a prefix match); at the row counts this feature expects, an unindexed `ILIKE` scan within one agency's rows is acceptable, and revisiting it is a Follow-up if an agency ever grows large enough to notice.

**Security model**:

Every action and read in this feature requires `requireStaff(ctx)`: any agency staff member, admin or member alike, may create, list, view, edit, archive, and restore. There is no admin only distinction for this feature; feature 16 (team members & roles) may add finer grained permissions later. A client contact (portal login) resolves to a contact context, not a staff context, and `requireStaff(ctx)` refuses it outright. Every query is scoped to `ctx.orgId` through `tenantDb()`; there is no path to another agency's rows. No compliance scope beyond ordinary business contact information; nothing here is payment, health, or government ID data.

**Critical test scenarios** (each maps to an acceptance criterion above):
- Happy path: create a client with just a name, see it in the active list, open it, edit a field, archive it with confirmation, find it under the archived filter, restore it, see it back in the active list. Verifies **AC-1**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-9**.
- Failure case: submitting an invalid company email on create is refused with an inline error and no row is written. Verifies **AC-3**.
- Concurrency: two edits to the same client seconds apart both succeed; the later save's values are what persist. Verifies **AC-14**.
- Auth and permission: a second agency's staff member given a direct link to the first agency's client id gets not found, not a permission error; a client contact visiting `/clients` is redirected before any client data loads, and a client contact context calling one of the four Server Actions directly gets refused. Verifies **AC-11**, **AC-12**.
- Empty and error state: a brand new agency with zero clients sees the empty state; a forced read failure shows the error state; both pass an axe scan in both themes. Verifies **AC-13**.
- Idempotency and pagination edge case: archiving an already archived client, and restoring an already active one, both succeed with no error; searching while on page 3 resets to page 1 instead of showing an empty list. Verifies **AC-8**, **AC-9**, **AC-4**, **AC-5**.

## Build plan

1. Generate and commit the migration adding `phone`, `industry`, and the six billing address columns to `clients`, plus the lowercase CHECK constraint on `company_email` mirroring `client_contacts.email`; extend its drizzle-zod schemas for the new fields. Satisfies **AC-1**.
2. Write the Zod input schemas for create and update: name required, trimmed, non-empty, and capped at 200 characters; every optional field preprocessed from a blank string to `undefined` before its own check runs; company email validated and lowercased when present; every text field capped at its named length. Satisfies **AC-1**, **AC-2**, **AC-3**.
3. One thread end to end: `createClient` as a `withTenantAction` returning the project's `Result` shape and redirecting to the new client on success, a minimal `/clients` list reading only active clients through `tenantDb` (page size 25, ordered by name then id), and the `/clients/new` form; prove a client created by one agency never shows up for another, and that a client contact is redirected before either route or action runs. Satisfies **AC-1**, **AC-4**, **AC-10**, **AC-11**, **AC-12**.
4. Detail and edit: `/clients/[id]` (with a route level `error.tsx` for an unexpected read failure), the `updateClient` action, and `/clients/[id]/edit`; a foreign agency's id resolves not found the same way a missing id does. Satisfies **AC-6**, **AC-7**, **AC-11**, **AC-14**.
5. Archive and restore: `archiveClient` and `restoreClient` (both a no-op success when already in the target state), the confirm dialog before archiving, and the active and archived toggle on the list; every write action revalidates the list and the detail page. Satisfies **AC-4**, **AC-8**, **AC-9**.
6. Thicken the list: page number pagination and the case insensitive name search box, both driven by URL search params so the server component stays the single source of truth; a search or filter change resets to page 1, and an out of range page number clamps to 1. Satisfies **AC-4**, **AC-5**.
7. Empty state, error state, and an accessibility pass (axe, both themes) across all four screens; add any new UI pattern this feature introduces (the archive confirm dialog, the address form group) to `/design`. Satisfies **AC-13**.

## Consequences

**Positive**:
- Closes the walking skeleton: a signed in agency user can now do a full real write and read through the tenant scoping layer, not just see a shell.
- The billing address is captured in structured columns now, so feature 14 (invoice PDF) can print it later without re-parsing free text or asking this question again.
- No new library, provider, or environment variable; the feature reuses the stack end to end.

**Negative / tradeoffs**:
- Structured billing address columns (six of them, all optional) are unused by this feature itself; they exist only for a future feature. If invoice PDF never needs a structured address, this was extra schema for nothing.
- Last write wins on concurrent edits means a staff member's changes can be silently overwritten by a colleague's slightly later save, with no warning to either.
- No admin versus member distinction on client actions; if the business later wants archiving restricted to admins, that is a new guard, not a config flip.

**Neutral**:
- One new migration, additive only (all new columns nullable), no backfill needed.
- The detail page intentionally has no placeholder sections for projects or invoices; those arrive with features 11 and 13.

## Follow-up

- [ ] When features 11 (projects) and 13 (invoices) land, decide whether archiving a client with active projects or invoices needs a guard or a warning; this spec has no such rows to consider yet.

## Rationale

Reasoning and options considered: see [rationale.md](rationale.md).
