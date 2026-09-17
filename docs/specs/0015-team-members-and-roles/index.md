# 0015. Team members and roles

**Date**: 2026-09-17
**Status**: Proposed

## Summary

This settles how an agency grows past one person. `/team` becomes a real page where any staff member can see who is on the team, and an admin can invite someone by email with a role, change a member's role, revoke a pending invitation, or remove a member (including leaving the agency themselves). Invitations are Clerk organization invitations (Clerk stores them, sends the email, and attaches the person to the agency with the chosen role when they accept), so there is no new table and no token handling of our own. Every action is admin only at the server, judged by the Clerk session claim (the role carried inside the signed in person's token) rather than the local mirror, and the last admin can never be demoted or removed. After Clerk confirms a role change or a removal, the action also writes the local `memberships` mirror so the rest of the product is right immediately instead of waiting for feature 17's webhook sync.

## Requirements

**User stories**:
- As an agency admin, I want to invite a colleague by email and pick their role, so that they can start working in the agency without me creating anything by hand.
- As an agency admin, I want to see everyone on the team and every invitation still out, so that I know who has access and can fix a wrong address.
- As an agency admin, I want to promote or demote a colleague and remove someone who has left, so that access matches who actually works here.
- As an agency admin who is leaving, I want to remove myself, so that I do not keep access to an agency I no longer work for.
- As an agency member, I want to see the team without being able to change it, so that I know who to ask and cannot break anything.
- As the person operating this product, I want every team change refused at the server for a member, so that hiding a button is never the only thing keeping someone out.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: `/team` replaces the `notFound()` placeholder inside the gated agency route group and renders for any staff context. It shows a **Members** table read live from Clerk's organization membership list for `ctx.clerkOrgId`, newest first, one row per membership with: the person (avatar, name, and the email as the name when Clerk has no name), a `You` badge on the acting person's own row (matched on the Clerk user id), the role as `Admin` or `Member`, and the joined date (the membership's created date, as a UTC calendar date, the same rule specs 0008 and 0009 use for dates). An admin also sees an **Invite** card above the table and a **Pending invitations** table below it (email, role, sent date as a UTC calendar date, a `Revoke` button), read from Clerk's organization invitation list with status `pending`, newest first; when there are none it reads `No pending invitations.` A member sees the Members table only, no invite card, no role controls, no remove buttons, and the visible line `Only an admin can invite people or change roles.` Both Clerk reads go through helpers in `src/auth/clerk.ts` that page through the whole list in pages of 100 until Clerk's total count is reached, so the page renders every row and there is no paging UI; a team under 100 costs one call per list.
- **AC-2**: The invite action takes an email and a role, parsed by Zod at the action boundary: the email trimmed and lowercased, a valid address of at most 254 characters; the role one of `admin` or `member`, defaulting to `member`. It calls Clerk's create organization invitation with the organization `ctx.clerkOrgId`, the inviter `ctx.clerkUserId`, the role mapped to `org:admin` or `org:member` by one shared mapping module, and the redirect URL `env().NEXT_PUBLIC_APP_URL` + `/sign-up`. Clerk sends the email. On success the action returns `ok` with the invitation id and revalidates `/team`. The invitee's link lands on the project's own `/sign-up`, where Clerk's prebuilt component consumes the ticket, the membership is attached with the invited role, and `/onboarding` from spec 0005 activates the agency. The first build slice proves this whole path on the deployed app before anything else is built, for both a brand new person and an address that already has an account (which Clerk is expected to hand to `/sign-in` with the ticket kept; if it does not, the fallback in Consequences applies).
- **AC-3**: Before creating an invitation the action reads the full member list and the full pending invitation list from Clerk (the paging helpers of AC-1) and compares the lowercased email against every member's email and every pending invitation's email. A match on a member returns `conflict` with the message that this person is already a member; a match on a pending invitation returns `conflict` with the message that this address already has an invitation, which can be revoked and sent again. No Clerk write happens on either. Clerk refuses the same duplicates itself; the pre check exists so the admin gets a specific message, and a Clerk duplicate refusal that slips past it (a race) is mapped to the already invited `conflict`.
- **AC-4**: The revoke action takes a Clerk invitation id. It reads the acting organization's full pending invitation list from Clerk, and an id not in that list (including an id from another organization, or one already accepted or revoked) returns `not_found`. It then calls Clerk's revoke organization invitation with `ctx.clerkUserId` as the requesting user, returns `ok`, and revalidates `/team`. Any admin of the organization may revoke any pending invitation, not only the admin who sent it. There is no resend action: resending is revoke, then invite again.
- **AC-5**: The change role action takes a Clerk membership id and a role (`admin` or `member`). It reads the acting organization's full membership list from Clerk (so the target resolution and the admin count below are never truncated); an id not in that list returns `not_found`. If the membership already has the requested role it returns `ok` and writes nothing. If the target is an admin, the requested role is `member`, and the list holds exactly one admin, it returns `conflict` with the message that the last admin cannot be demoted and someone else must be made admin first. Otherwise it calls Clerk's update organization membership (the Clerk user id taken from the membership just read, never from input) with the mapped Clerk role, then writes through: updates `memberships.role` for the row where `org_id` is `ctx.orgId` and `user_id` is the local `users` row for that Clerk user id, if such rows exist (none means the person has never visited and there is nothing to update). It returns `ok` with the new role and revalidates `/team`.
- **AC-6**: The remove action takes a Clerk membership id. Same `not_found` rule as AC-5. If the target is the only admin in the list it returns `conflict` with the message that the last admin cannot be removed. Otherwise it calls Clerk's delete organization membership for that Clerk user id, then writes through by hard deleting **only** the `memberships` row where `org_id` is `ctx.orgId` and `user_id` is the local `users` row for that Clerk user id, when both rows exist (`memberships` has no soft delete column). The `users` row is never deleted or changed: it is shared across every agency the person belongs to and `memberships.user_id` cascades on its deletion, so touching it would remove them from other agencies. It returns `ok` with `self: true` when the removed membership was the acting person's own, otherwise `self: false`, and revalidates `/team`.
- **AC-7**: An admin may change their own role or remove themselves, subject to the last admin rules in AC-5 and AC-6. After removing themselves the client sets the active Clerk organization to none (which reissues the session token without the organization) and navigates to `/onboarding`. After demoting themselves the client reactivates the same organization (which reissues the token with the new role) and refreshes the page, so they immediately see the member view of `/team`.
- **AC-8**: All four actions are declared through `withTenantAction({ requireRole: "admin" })` with the default subscription gate, so a member is refused with `forbidden` by the Clerk session claim before any input is parsed and before any Clerk call, and an agency without full access is refused with `subscription_inactive`. No action, page, or helper reads `memberships.role` to decide what someone may do.
- **AC-9**: Every Clerk call in this feature passes `ctx.clerkOrgId` as the organization; no organization id, user id, or role ever comes from the request other than the target membership or invitation id, which AC-4 to AC-6 resolve against the acting organization's own lists. A membership or invitation id belonging to another organization is therefore `not_found`, never acted on.
- **AC-10**: When Clerk accepts a role change or a removal and the mirror write then fails, the action still returns `ok` (Clerk is authoritative and the change is real) and writes one error level log line naming the operation, the organization id and the target Clerk user id, so the mirror drift is visible. The person's next visit repairs the mirror through spec 0005's path, and feature 17 keeps it right afterwards.
- **AC-11**: When Clerk cannot be reached while `/team` renders, the page frame, heading, and (for an admin) the invite card still render, and the list area shows an error card with the heading `The team list could not be loaded`, the body `Try again in a moment.`, and a `Try again` link back to `/team`. The page never falls back to the local mirror. When Clerk fails inside an action, the action returns `unavailable`: for a failure before the Clerk write the message is `The team service could not be reached. Nothing was changed.`; for a failure on the write itself it is `The team service could not be reached. The change may or may not have applied; reload the page to check.`; and for a Clerk rate limit refusal (HTTP 429, which the wrapper in `src/auth/clerk.ts` tells apart by status the way it already tells apart a 404) it is `The team service is busy. Try again in a minute.` The log line records which of the three it was.
- **AC-12**: Spec 0005's mirror repair in `src/auth/context.ts` no longer recreates rows from the organization and user records alone. It runs three Clerk reads together (`clerkOrganization`, `clerkUser`, and `agencyMemberships(clerkUserId)`), keeps the first two because `ensureMirrorRows` needs their full records, and confirms the third holds a membership for `clerkOrgId`, taking the role from that membership rather than the session claim. If none exists the person is redirected to `/onboarding`. This is what stops a removed member, whose token still carries the old organization for up to a minute, from reviving their own `memberships` row by visiting a page.
- **AC-13**: Every invite, revoke, role change and removal writes one structured log line with the organization id, the acting person's `users.id`, the target, the requested role where there is one, and the outcome (`ok`, `conflict`, `not_found`, `unavailable`, `invalid`). The target is the invitation id for a revoke and for an invite that Clerk created, `none` for an invite that stopped before Clerk created anything, and the membership id plus the Clerk user id for a role change or removal. A `conflict` outcome also names its kind (`already_member`, `already_invited`, `last_admin`). No log line written by this feature contains an email address.
- **AC-14**: Role changes are made with a per row select that saves on change, shows a pending state while the action runs, and announces the result (`Role updated` or the refusal message) inline in an `aria-live` region. On the acting admin's own row, when they are the only admin, the select and the remove button are disabled and the visible text `You are the only admin. Make someone else an admin first.` sits next to them, not in a tooltip. Removing opens an accessible confirm dialog (focus trapped, closed by Escape, focus returned to the trigger) that names the person: `Remove <name> from <agency name>? They lose access immediately.`, with `Remove` and `Cancel`. On the acting person's own row the button reads `Leave agency` and the dialog says `Leave <agency name>? You will be signed out of this agency and will need a new invitation to return.` Every state of the page, including the member view, the empty pending list, and the Clerk error card, meets WCAG 2.2 AA.
- **AC-15**: The `/settings` placeholder stays a `notFound()` page and its comment no longer claims feature 16 replaces it; it points at a later settings feature instead. The existing sidebar link to `/team` opens the real page.

## Decision

**Chosen option**: Option 2: The project's own `/team` page and four Server Actions over Clerk's Backend API, with Clerk organization invitations carrying the invite

Staff management is built as an ordinary feature of this product: a Server Component page reading Clerk's membership and invitation lists, four `withTenantAction` writes calling Clerk's organization endpoints and writing through to the local mirror, with invitations, their email, and their acceptance left entirely to Clerk. Full reasoning and the options weighed are in [rationale.md](rationale.md).

**Implementation skills**: `clerk-orgs` (`clerk/agent-skills`, `.agents/skills/clerk-orgs/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `zod` (`.agents/skills/zod/`) · `shadcn` (`.agents/skills/shadcn/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `vitest` (`.agents/skills/vitest/`)

## Feature design

**Data model sketch**:

No migration. This feature creates no table and adds no column.

| Entity | Lives in | Key | Fields this feature touches | Relationship |
|---|---|---|---|---|
| Organization membership | Clerk, authoritative | Clerk membership id | Clerk user id, role `org:admin` or `org:member`, created date, public user data (first name, last name, identifier email, image URL) | N per organization, exactly one per person per organization (Clerk enforces) |
| Organization invitation | Clerk only | Clerk invitation id | email address, role, status `pending`, `accepted`, `revoked` or `expired`, created date | N per organization; only `pending` is read; no local copy |
| `memberships` (mirror) | Postgres, exists (spec 0002) | `id` uuid | `org_id` FK `organizations`, `user_id` FK `users`, `role` `admin` or `member` (CHECK), timestamps; unique on (`org_id`, `user_id`) | written through here: `role` updated on a role change, the row hard deleted on removal, never inserted by this feature |
| `users` (mirror) | Postgres, exists | `id` uuid | `clerk_user_id` unique, `email`, `name`, `image_url` | read only here, to find the `memberships` row a write through targets; never inserted, updated or deleted by this feature (shared across agencies, and `memberships.user_id` cascades on its deletion); created only by spec 0005's repair path on first visit |

Feature folder `src/team/`: `rules.ts` (pure decisions: last admin check, duplicate email check, the `admin`/`member` to `org:admin`/`org:member` mapping alongside spec 0003's existing `toMembershipRole`), `queries.ts` (the team view assembled from the Clerk reads), `actions.ts` (the four Server Actions), `ui/` (the page's components). The Clerk calls themselves are added to `src/auth/clerk.ts`, the one module that already keeps Clerk's shapes out of the product, each returning a `Result` and throwing only on the failures that module already throws on.

**State transitions**:

Invitation (held by Clerk): `pending` → `accepted` (the invitee signs up or in with the ticket) · `pending` → `revoked` (an admin revokes, AC-4) · `pending` → `expired` (Clerk's own expiry; expired invitations are not listed and are recreated by inviting again).

Membership role: `member` ⇄ `admin` (AC-5), with `admin` → `member` refused when it would leave zero admins. Membership: present → removed (AC-6), refused for the last admin. A removed person comes back only through a new invitation.

**API surface**:

All four are Server Actions in `src/team/actions.ts`, declared through `withTenantAction` and returning the project's `Result` shape. The page is a Server Component.

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/team` | GET (page) | none (organization from the session) | members list, pending invitations list (admin only), the acting role, the agency name | staff session, gated route group | Clerk unreachable → error card (AC-11) |
| `inviteTeamMember` | Server Action | `email: string` (req, lowercased, ≤ 254), `role: "admin" \| "member"` (opt, default `member`) | `invitationId` | admin claim, full access | `conflict` already a member or already invited (AC-3), `unavailable` Clerk failure, `forbidden`, `subscription_inactive`, `invalid` |
| `revokeTeamInvitation` | Server Action | `invitationId: string` (req) | none | admin claim, full access | `not_found` (AC-4), `unavailable`, `forbidden` |
| `changeTeamMemberRole` | Server Action | `membershipId: string` (req), `role: "admin" \| "member"` (req) | `role` | admin claim, full access | `not_found`, `conflict` last admin (AC-5), `unavailable`, `forbidden` |
| `removeTeamMember` | Server Action | `membershipId: string` (req) | `self: boolean` | admin claim, full access | `not_found`, `conflict` last admin (AC-6), `unavailable`, `forbidden` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `/team` page | which organization's team | `ctx.clerkOrgId` from `agencyContext()` (spec 0005), never the URL |
| `/team` page | member rows: name, email, avatar, role, joined | the full Clerk membership list (paged in 100s to the total count), newest first: `publicUserData.firstName` + `lastName` (falling back to `publicUserData.identifier`), `publicUserData.identifier`, `publicUserData.imageUrl`, `role` mapped through `toMembershipRole`, `createdAt` as a UTC calendar date |
| `/team` page | the `You` badge | `publicUserData.userId` equals `ctx.clerkUserId` |
| `/team` page | whether to show the invite card, role controls, remove buttons | `ctx.role` from the session claim (spec 0003) |
| `/team` page | pending invitation rows: email, role, sent | the full Clerk invitation list filtered to `pending`, newest first: `emailAddress`, `role` mapped, `createdAt` as a UTC calendar date |
| `/team` page | agency name in the dialogs | the local `organizations` row through `currentAgency()` (spec 0005, AC-15) |
| `/team` page | whether the acting admin is the last admin (to disable their own controls) | count of `org:admin` rows in the full membership list just read |
| `/team` page | the fixed strings (member note, empty pending list, error card, disabled reason, dialog copy) | decided in AC-1, AC-11 and AC-14 of this spec |
| `inviteTeamMember` | organization, inviter | `ctx.clerkOrgId`, `ctx.clerkUserId` |
| `inviteTeamMember` | Clerk role string | input `role` through the shared mapping in `src/team/rules.ts` |
| `inviteTeamMember` | redirect URL | `env().NEXT_PUBLIC_APP_URL` + `/sign-up` (decided here) |
| `inviteTeamMember` | duplicate verdict | lowercased input email against the member identifiers and pending invitation emails read from Clerk in the same action |
| `revokeTeamInvitation` | requesting user | `ctx.clerkUserId` |
| `revokeTeamInvitation` | whether the id belongs to this organization | presence in the pending list read for `ctx.clerkOrgId` |
| `changeTeamMemberRole` / `removeTeamMember` | the target's Clerk user id | `publicUserData.userId` of the membership found in the list read for `ctx.clerkOrgId` |
| `changeTeamMemberRole` / `removeTeamMember` | last admin verdict | count of admins in that same full list, computed by the pure rule in `rules.ts` |
| `changeTeamMemberRole` / `removeTeamMember` | the mirror row to write | `users.clerk_user_id` equals the target Clerk user id, joined to `memberships` on `org_id` = `ctx.orgId`, through `tenantDb(ctx)` |
| `removeTeamMember` | `self` | target Clerk user id equals `ctx.clerkUserId` |
| every action | log line fields | `ctx.orgId`, `ctx.userId`, the target per AC-13 (`none` for an invite that never reached Clerk), the outcome and conflict kind |
| every action | which `unavailable` message | whether the Clerk failure came before or on the write, and whether its status was 429, as the wrapper reports it (AC-11) |
| repair path (AC-12) | whether to recreate rows, and with which role | `agencyMemberships(clerkUserId)` from `src/auth/clerk.ts` filtered to `clerkOrgId`, read together with the existing two calls; the role from that membership |

**Key invariants**:
- An organization always has at least one admin membership in Clerk after any action this feature performs (AC-5, AC-6). Enforced in the action from the list read in the same call; a two admin race is accepted and documented in Consequences.
- The authoritative role is the Clerk session claim, carried on the context; `memberships.role` is a display mirror (spec 0003). Nothing in this feature reads the mirror to decide what a person may do (AC-8).
- Every Clerk call carries `ctx.clerkOrgId` as the organization (AC-9). A target id is only ever resolved through the acting organization's own lists.
- The mirror is written only after Clerk has confirmed the change, and a mirror failure never reverses or hides a Clerk change (AC-10). This feature only ever updates or deletes a `memberships` row scoped to `ctx.orgId`; it never inserts one and never writes `users` at all. Only spec 0005's repair path and feature 17 create rows.
- Every list an action resolves a target from, counts admins in, or checks duplicates against is the full Clerk list, never a truncated page (AC-1, AC-3, AC-5).
- `memberships.role` stays within its CHECK (`admin`, `member`) because the only value written is the parsed input role.
- No email address is written to a log line (AC-13).

**Security model**:
- Read `/team`: any staff context (`admin` or `member`) with a session on the gated route group; a client contact context is redirected away by the proxy and refused by `requireStaff` on every action. The team of another agency is unreachable because the organization comes only from the session.
- Write (all four actions): `admin` by session claim only, full subscription access (the `withTenantAction` default). A member receives `forbidden` before input parsing and before any Clerk call.
- The Clerk secret key is server side only, in `src/auth/clerk.ts`, as today.
- Personal data handled: staff names and email addresses, read from Clerk and shown to staff of the same agency only; never logged (AC-13). No payment or regulated data; no new compliance scope.
- Rate limiting of the invite action is deferred to feature 19, which this spec names as a required limiter target (see Follow-up). Clerk applies its own per application limit on invitation creation in the meantime.

**Configuration required**:

No new environment variables. `NEXT_PUBLIC_APP_URL` and Clerk's keys already exist in `src/lib/env.ts`. No Clerk dashboard change is required: organizations and Clerk's own invitation email are already on for this application (spec 0005).

**Critical test scenarios**:
- Happy path: an admin invites `alex@example.com` as `member`; the invitation appears in Pending; on the deployed app the email arrives, `/sign-up` consumes the ticket, `/onboarding` activates the agency, and Alex appears in Members as a member; verifies **AC-1**, **AC-2**.
- Happy path: an admin promotes Alex to admin, then demotes themselves; their next `/team` render is the member view; verifies **AC-5**, **AC-7**.
- Failure case: the only admin tries to demote or remove themselves and receives `conflict` with the last admin message; the page shows the disabled controls with the visible reason; verifies **AC-5**, **AC-6**, **AC-14**.
- Failure case: inviting an address that already has a pending invitation returns `conflict` with the already invited message and makes no Clerk write; verifies **AC-3**.
- Failure case: Clerk accepts a removal and the mirror delete throws; the action returns `ok` and one error level line is logged; verifies **AC-10**.
- Failure case: the stubbed Clerk client throws on the list read while `/team` renders; the shell and heading render with the error card; verifies **AC-11**.
- Failure case: a removed person's stale session revisits `/dashboard`; the repair path finds no Clerk membership and redirects to `/onboarding` without creating a `memberships` row; verifies **AC-12**.
- Auth/permission: a member calls each of the four actions and receives `forbidden`, with the Clerk stub recording zero calls; a membership id from another organization returns `not_found`; verifies **AC-8**, **AC-9**.
- Auth/permission: an agency in the grace window calls invite and receives `subscription_inactive`; verifies **AC-8**.
- Logging: every action outcome writes one line with the organization id, actor, target and outcome, and no line contains `@`; verifies **AC-13**.

## Build plan

Ordered for the Tracer Bullet approach: the first slice runs the thinnest complete thread (page lists members, one invite goes out through Clerk, the invitee lands in the agency) on the deployed app, because the invite path crosses Clerk's email, the ticket handling in the prebuilt sign up component, and spec 0005's onboarding, and that is the part most likely to surprise. Everything after thickens the page and the actions. No migration task exists because the data model adds nothing.

1. Add the Clerk calls to `src/auth/clerk.ts`: list organization memberships and list pending organization invitations (both paging in 100s to Clerk's total count), create organization invitation, revoke organization invitation, update organization membership, delete organization membership; each takes `clerkOrgId` explicitly and returns a `Result`, with a 404 as `not_found`, a 429 told apart for AC-11's busy message, and other failures thrown as that module already does. Add `toClerkRole` beside spec 0003's `toMembershipRole` and expose both through `src/team/rules.ts`. Satisfies **AC-2**, **AC-9**.
2. Thin thread: replace the `/team` placeholder with a Server Component that reads the membership list through `src/team/queries.ts` and renders the Members table (person, `You` badge, role, joined), plus the invite card and the `inviteTeamMember` action with the Zod input, the role mapping and the `/sign-up` redirect URL. Deploy, send a real invitation to a second mailbox, accept it through `/sign-up`, land on `/onboarding`, and confirm the new member appears; repeat with an address that already has an account. Satisfies **AC-1** (members view), **AC-2**.
3. Pending invitations: read the pending list, render the Pending invitations table for admins, add `revokeTeamInvitation` with the `not_found` resolution against the list. Satisfies **AC-1** (pending view), **AC-4**.
4. Duplicate checks in `inviteTeamMember`: the pure `duplicateEmail` rule in `rules.ts` over the two full lists, returning the two `conflict` messages, plus the mapping of Clerk's own duplicate refusal to the already invited `conflict`. Satisfies **AC-3**.
5. Role change: `changeTeamMemberRole` with the `not_found` resolution, the no op on the same role, the pure `lastAdminBlocks` rule, the Clerk update, and the write through to `memberships.role` through `tenantDb(ctx)`; the per row role select with pending state and the `aria-live` result. Satisfies **AC-5**, **AC-14** (select).
6. Removal: `removeTeamMember` with the last admin rule, the Clerk delete, the hard delete of the `memberships` row only (never `users`), `self`, and the accessible confirm dialog with the two wordings. Client handling of self actions: set the active organization to none and go to `/onboarding` after leaving; reactivate the same organization and refresh after self demotion. Satisfies **AC-6**, **AC-7**, **AC-14** (dialog).
7. Half done handling and logging: wrap each mirror write so a failure after a Clerk success logs at error level and still returns `ok`; add the structured log line to every action outcome with the target and conflict kind of AC-13 and no email address. Satisfies **AC-10**, **AC-13**.
8. Harden spec 0005's repair path in `src/auth/context.ts`: add `agencyMemberships()` to the existing `Promise.all`, confirm a membership for `clerkOrgId` before `ensureMirrorRows`, take the role from it, redirect to `/onboarding` when absent; update `src/auth/context.test.ts` for the removed person case. Satisfies **AC-12**.
9. Error and member states: the Clerk error card with `Try again` on the page, the three `unavailable` messages in the actions, the member view with its one line note, the empty pending state, and an accessibility pass over every state. Satisfies **AC-11**, **AC-1**, **AC-14**.
10. Confirm the gate and the guards: declare all four actions with `requireRole: "admin"` and the default subscription setting, and test a member and a grace window agency against each. Satisfies **AC-8**.
11. Update the `/settings` placeholder comment to point at a later settings feature. Satisfies **AC-15**.
12. Tests per the GA workflow: Vitest on `rules.ts` (last admin, duplicates, role mapping), action tests with a stubbed `src/auth/clerk.ts` covering every scenario above, a page test for the admin and member views and the error card, and Playwright for the page rendering as admin and as member (the real invitation email stays a manual check on the deployed app, as spec 0005 did for sign up). Satisfies **AC-1** to **AC-14**.

## Consequences

**Positive**:
- No new table, no migration, no token handling, no email template: Clerk carries the invitation, its email, its expiry and its acceptance, and the project keeps one identity provider for staff.
- The scope's demand is met literally: a member is refused at the server by the session claim, the same guard every other write uses, so `/team` cannot become the one feature with a different rule.
- The mirror is right the moment an admin acts, so the dashboard, billing and any join on `memberships.role` do not wait on feature 17.
- The repair path hardening (AC-12) closes a hole that already existed in spec 0005: it could recreate a membership for a person Clerk had removed. Fixing it here means removal actually removes.

**Negative / tradeoffs**:
- Every `/team` render costs two Clerk API calls, and every action costs one or two reads plus one write. Acceptable for a page opened rarely by small teams; Clerk's rate limits (in the hundreds per hour for invitations) are far above this product's use, but an outage of Clerk takes the team page down with it, by design, rather than showing a possibly wrong mirror.
- A demoted admin keeps admin powers for up to a minute, and a removed person keeps a working token for the same window, because Clerk's session tokens live about a minute and this spec chose not to revoke sessions. AC-12 makes sure the removed person cannot rebuild their mirror row in that window; the demoted admin can still act as admin once or twice. Every other feature already lives with the same token lifetime.
- The last admin rule and the duplicate check are checked against a full list read a moment earlier, not atomically. Two admins demoting or removing each other within the same second can leave an agency with no admin; recovery is a support action in the Clerk dashboard. Judged not worth a lock tied to a Clerk write on the pooled connection.
- The lists are read in full and rendered in full, with no paging UI. A team in the hundreds would make `/team` a long page and cost a Clerk call per hundred rows on every view and action; paging UI is a follow up for when any agency gets there, and correctness never depends on it.
- The invitee experience depends on Clerk's prebuilt sign up and sign in components consuming the ticket. Build slice 2 proves it on the deployed app before anything else is built; if it fails, the fallback is a small `/team/accept` page using Clerk's ticket strategy, which would be a spec update, not a redesign.
- Removing a member hard deletes their `memberships` row (and only that row), so the local history of who was on a team is gone; the structured log lines and Clerk's own records are the audit trail. A product wide `audit_events` table was deliberately not started here.

**Neutral**:
- `src/auth/clerk.ts` grows from four calls to ten. It stays the one module that knows Clerk's shapes.
- Invitations expire on Clerk's schedule and expired ones are simply not shown; an admin invites again.
- Feature 17's webhook handlers will find `memberships` already in the state their events describe for changes made through this page, and must treat that as a no op (they are specified as idempotent upserts and deletes anyway).
- `/settings` remains a placeholder, now honestly labelled.

## Follow-up

- [ ] Feature 19 (rate limiting) must list `inviteTeamMember` as a limiter target; this spec relies on Clerk's own limit until then.
- [ ] Feature 17 (Clerk webhook sync) should note that `organizationMembership.updated` and `organizationMembership.deleted` events for changes made through this page arrive after the mirror already matches, and that an `organizationMembership.created` event is the normal way a mirror row appears for an invitee who has not yet visited.
- [ ] A paging UI for the member and pending invitation lists if any agency grows into the hundreds; until then the page renders the full lists.
- [ ] A settings feature for `/settings` (agency name, default currency) needs its own scope row; this spec only relabels the placeholder.
- [ ] If a queryable audit history is wanted, design an `audit_events` table as a cross cutting decision rather than adding one per feature.
- [ ] `clerk-orgs` conventions are not yet captured in a nested `src/auth/AGENTS.md`; that file should carry the Clerk organization and invitation conventions (which calls live in `src/auth/clerk.ts`, the role mapping module, the ticket landing on `/sign-up`) before implementation begins, with a one line pointer from root `AGENTS.md`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
