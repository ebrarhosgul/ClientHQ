# 0015. Team members and roles: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file is for the humans who want the why.

## Context

ClientHQ is a multi tenant portal where each agency is a Clerk organization (spec 0005) and every staff member is a Clerk organization membership with one of two roles, `org:admin` or `org:member`, mirrored locally as `memberships.role` with a CHECK of `admin` or `member` (spec 0002). Spec 0003 fixed the rule that the Clerk session claim is the authoritative role and the local column is a display mirror that may lag. Spec 0005 creates the first admin when an agency is created and repairs missing mirror rows on a person's first visit. Billing (specs 0007 and 0008) already refuses a member at the server. What does not exist is any way for an agency to become more than one person: `/team` is a placeholder that returns not found, and the only membership Clerk ever holds for an agency is the founder's.

The forces are these. Clerk is already the identity provider, already sends emails for sign up and verification, and already owns organization membership; anything built beside it has to stay consistent with what Clerk believes. The local mirror is real and is joined by other features, so a change made in Clerk that the mirror does not see leaves the product showing stale roles until feature 17 (the webhook sync) exists, and that feature is not built yet. The scope row is explicit that a member must be refused at the server and that permission checks must read the session role, not the mirror. The team is small and the product is early: every agency is a handful of people, and the subscription is a flat monthly price with no seat count. The load bearing rule of the whole codebase, that nothing outside the tenant layer touches the raw database handle, means any mirror write goes through `tenantDb(ctx)` like every other write.

Not deciding leaves every agency a single admin forever, which blocks the product's own premise (agencies have staff), and leaves the `/team` link in the sidebar pointing at a not found page. Deciding badly, for example by inventing a second invitation system next to Clerk's, doubles the identity surface the team has to keep consistent and puts a second email pipeline in the product for the same job.

One more force surfaced during design and belongs here: Clerk session tokens live about a minute, so any removal or demotion has a window in which the person's old token still passes the proxy. Spec 0005's repair path recreates mirror rows from the organization and user records alone, so in that window a removed person visiting any agency page would have rebuilt their own membership row. Whatever this spec chose for invitations, that gap had to close for removal to mean anything.

## Options considered

### Option 1: Mount Clerk's prebuilt organization profile component on `/team`

Render Clerk's `<OrganizationProfile />` inside the agency shell, themed with the appearance tokens spec 0004 established for the sign in and sign up components. Clerk's component lists members, invites by email, changes roles, revokes invitations and removes members, all against Clerk's own API with Clerk's own permission checks (`org:sys_memberships:manage`, which `org:admin` holds and `org:member` does not).

**Pros**:
- The least code by far: one page, no Server Actions, no Clerk wrapper calls, no rules module.
- Clerk enforces the permission check itself, server side, in the same way it does in its dashboard.
- Invitation, email, expiry and acceptance all come for free, and Clerk's UI already handles pending invitations and the ticket flow.

**Cons**:
- The mirror cannot be written through, because the component talks to Clerk directly from the browser; the local `memberships.role` stays wrong until feature 17 exists, and the dashboard, the portal and any join on that column show stale roles in the meantime.
- The last admin rule, the confirm dialog wording, the `You` badge, the self leave flow and the log lines are whatever Clerk's component does, not what this product decides; the scope's demand that permission checks read the session role through the project's own guards is met by Clerk's checks rather than by `withTenantAction`, which makes `/team` the one write surface with a different guard convention.
- The appearance API themes the component but does not make it look or behave like the rest of the product (its own tabs, its own navigation, its own copy), and the accessibility of every state is Clerk's to fix, not the team's.
- The subscription gate (spec 0008) cannot be applied to writes made from the browser to Clerk; a locked agency could still manage its team.

### Option 2: The project's own `/team` page and four Server Actions over Clerk's Backend API, with Clerk organization invitations carrying the invite

Build `/team` as an ordinary feature: a Server Component reads Clerk's membership and pending invitation lists for the acting organization; four Server Actions (invite, revoke invitation, change role, remove member) go through `withTenantAction({ requireRole: "admin" })`, call Clerk's organization endpoints from the server, and then write the local mirror once Clerk has confirmed. Invitations are Clerk organization invitations: Clerk stores them, sends the email, and attaches the person with the invited role when they accept through the project's own `/sign-up`, where Clerk's prebuilt component consumes the ticket, after which spec 0005's `/onboarding` activates the agency.

**Pros**:
- Every write goes through the same guard, gate and `Result` shape as every other write in the product, so the scope's server side refusal is met by the project's own convention and the subscription gate applies.
- The mirror is right immediately, and feature 17 becomes a safety net rather than a prerequisite.
- The product decides its own rules (last admin, self leave, duplicate messages, dialog copy, log lines) and its own accessible UI, consistent with spec 0004.
- Clerk still carries the invitation, its email, expiry and acceptance, so there is no new table, no token handling and no second email pipeline.

**Cons**:
- Meaningfully more code than Option 1: six Clerk wrapper calls, four actions, a rules module, a page with three sections and a dialog, and their tests.
- Two Clerk API calls on every page view and one or two per action; a Clerk outage takes the page down, by choice, rather than showing a possibly wrong mirror.
- The invite path depends on Clerk's prebuilt sign up and sign in components consuming the ticket at a custom redirect URL, which has to be proven on the deployed app rather than assumed.
- The last admin rule is checked from a list read a moment earlier and is not atomic; a two admin race is accepted.

### Option 3: The project's own invitation flow through Resend, as spec 0009 did for client contacts

Keep the page and actions of Option 2 but replace Clerk invitations with a local `team_invitations` table holding a hashed token, a React Email template sent through Resend, and an accept page that verifies the token and then creates the Clerk membership through the Backend API.

**Pros**:
- Full control over the email's look, the accept page, the expiry and the wording, in the same style as the client contact invitation.
- A local record of every invitation for audit and for counting limits without asking Clerk.

**Cons**:
- Reimplements what Clerk already does for organizations: storage, expiry, email, and binding the person to the organization with a role, plus a new door into Clerk that creates memberships from a token the product minted.
- Spec 0009 built its own flow because client contacts are not organization members and Clerk had nothing to offer for them; staff are organization members, and Clerk's invitation is the native fit.
- Adds a migration, a template, a token module and an accept page to a feature that otherwise needs none of them, and a second place where the mirror and Clerk can disagree.

## Rationale

Option 2 is chosen because the product already has a convention for writes (`withTenantAction`, the admin guard by session claim, the subscription gate, the `Result` shape, the log line) and the scope row asks, in so many words, for a member to be refused at the server by the session role. Option 1 meets that demand only by delegating it to Clerk's component, which also makes the subscription gate unenforceable for team writes and leaves the mirror stale until a feature that does not exist yet. The mirror matters because other features join `memberships.role` today; the write through in Option 2 is a small amount of code that makes feature 17 a safety net instead of a blocker.

Option 3 was rejected for the reason spec 0009 chose it: that spec needed its own flow because client contacts are not organization members. Staff are exactly what Clerk organization invitations are for, and inventing a parallel invitation system would double the identity surface for no gain in the product's control over anything it cares about. The email is Clerk's, which is a cosmetic loss the engineer accepted knowingly; the invite landing on the project's own `/sign-up` keeps the visible pages themed as spec 0005 built them.

Within Option 2 the engineer settled the finer calls and the reasons are worth recording. The page reads Clerk live rather than the mirror because the mirror only knows people who have visited until feature 17 exists, and a team page that omits people who accepted but never signed in is worse than one that costs two API calls. The last admin rule is enforced with a `conflict` rather than a warning because an agency that strands itself has no way back except support. Self actions are allowed because a sole staff member of an agency must be able to leave. Sessions are not revoked on removal because revoking signs the person out of every agency they belong to, and every other feature already lives with the one minute token lifetime; instead the repair path is hardened (AC-12) so the window cannot be used to rebuild a membership. A mirror failure after a Clerk success returns `ok` with an error log because reporting failure would invite a retry that Clerk refuses as already done. The lists are read in full through paging helpers rather than capped, because the same read decides whether a target belongs to the organization and how many admins remain, and a truncated list would make a member past the cap unmanageable and the last admin count wrong; there is still no paging UI because no agency on this product is anywhere near needing one. The `users` row is never written by this feature because it is shared across agencies and `memberships.user_id` cascades on its deletion; only the one `memberships` row scoped to the acting organization is touched. The duplicate pre check is kept even though Clerk refuses the same duplicates, because Clerk's refusal is generic and the admin deserves to be told which of the two cases they hit. No rate limit and no seat cap are added here because both are other decisions (feature 19 and pricing) and both have a single named place to land.

Three decisions were mine to make with the full picture and are recorded as decided, with the runner up: the target of a role change or removal is the Clerk membership id (runner up: the Clerk user id), because it is what the page lists and it forces the action to re resolve the target against the acting organization's own list, which is the cross tenant check; the invite redirect lands on `/sign-up` (runner up: Clerk's Account Portal) so the invitee sees the themed pages spec 0005 built; and the feature lives in `src/team/` with the Clerk calls added to `src/auth/clerk.ts` (runner up: a Clerk client inside `src/team/`), because that module is already the one place that keeps Clerk's shapes out of the product and tells a 404 apart from an outage.
