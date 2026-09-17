# Verify: team members and roles · spec 0015 · updated 2026-09-17

_Steps derived from spec 0015 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Known gaps (accepted 2026-09-17)

The engineer ran the core flows by hand on the deployed app (open `/team`, send an invite, revoke it, promote to Admin, the solo admin lock, remove a member) and called it good enough to ship, alongside the full green test suite. The lines below are still unticked, meaning nobody has exercised them yet, not that they were checked and passed. Accepted as a known gap rather than a silent skip; worth picking up in `/test team members & roles` or a follow up verify pass:

- The invitation acceptance path itself (the email link through sign up to `/dashboard`) and the existing account sign in path → AC-2
- The duplicate invite conflict messages → AC-3
- Self demoting with another admin present, and leaving the agency as a non last admin → AC-7
- The member view (signed in as a member) and the console `forbidden` / `subscription_inactive` checks → AC-8
- The wrong `CLERK_SECRET_KEY` card and the "Clerk unreachable" message → AC-11
- The server log line check → AC-13
- `/settings` still showing not found → AC-15
- The keyboard only walk, 200 percent zoom, and 320 pixel width check → AC-14
- All five value sourcing checks (name fallback to email, the `You` badge following the Clerk user id, date formatting, a foreign membership id, 100+ memberships) → AC-1, AC-5, AC-6, AC-9

## UI / manual

Signed in on the deployed app as an agency admin unless a step says otherwise.

- [x] Open `/team` → the header, the invite card, the Members table with your own row carrying `You`, and the Pending invitations section → AC-1
- [x] Invite a fresh mailbox as `member` → `Invitation sent to <email>.` is announced, the row appears under Pending with role Member and today's date as `<day> <month> <year> (UTC)` → AC-1, AC-2
- [ ] Open that email and follow the link → it lands on the app's own `/sign-up`; sign up; land on `/onboarding`, then `/dashboard`; back on `/team` the person is listed in Members as Member → AC-2
- [ ] Repeat the invitation with an address that already has an account → Clerk hands it to `/sign-in` with the ticket kept and the membership is attached on sign in → AC-2
- [ ] Invite an address that is already a member → a conflict beside the email field saying they are already a member; invite an address with a pending invitation → the already invited message → AC-3
- [x] Revoke a pending invitation → the row is gone; the old link in the email no longer works → AC-4
- [x] Change the new member to Admin → `Role updated` is announced beside the control; after a reload both rows read Admin and the count line says 2 admins → AC-5
- [x] Before promoting anyone, as the only admin → your own role select and `Leave agency` are disabled, with `You are the only admin. Make someone else an admin first.` as visible text → AC-5, AC-6, AC-14
- [ ] With another admin present, demote yourself → the page refreshes into the member view (the note line, roles as text, no controls) → AC-7
- [ ] Sign in as a member and open `/team` → the note `Only an admin can invite people or change roles.`, no invite card, no controls, no Pending section → AC-1, AC-8
- [ ] As a member, call `inviteTeamMember` from the browser console → `forbidden`; as an admin of an agency in the grace window → `subscription_inactive` → AC-8
- [x] Remove a member → the dialog reads `Remove <name> from <agency>?` with `They lose access immediately.`; after confirm the row is gone; as that person, revisit `/dashboard` within a minute → land on `/onboarding`, and no new `memberships` row appears in the database → AC-6, AC-12
- [ ] As a non last admin, choose `Leave agency` → the dialog reads `Leave <agency>?` and says you will be signed out of this agency; confirm → `/onboarding` → AC-7
- [ ] On a preview with a wrong `CLERK_SECRET_KEY`, open `/team` → the frame, the heading and the invite card render; the list area shows `The team list could not be loaded`, `Try again in a moment.` and a `Try again` link to `/team` → AC-11
- [ ] With Clerk unreachable, submit an invitation → `The team service could not be reached. Nothing was changed.` → AC-11
- [ ] In the server logs after this walk → one `team.management` line per action carrying `orgId`, `actorUserId`, the target and the outcome; no line contains `@` → AC-13
- [ ] Open `/settings` → still the not found page inside the shell → AC-15
- [ ] Keyboard only: tab through `/team`, open the role select, open and Escape the remove dialog, focus returns to the button; zoom to 200 percent; 320 pixel width scrolls in one direction only → AC-14

## Commands

- [x] `corepack pnpm vitest run src/team src/auth` → 151 tests green → AC-1 to AC-14
- [x] `corepack pnpm test:e2e` → `/design` axe passes in both themes with the Team section rendered → AC-14
- [x] `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check` → clean

## Value sourcing checks

- [ ] A member whose Clerk account has no name → the row shows the email as the name, once, with no duplicate email line → AC-1
- [ ] The `You` badge follows the Clerk user id, not the email: sign in as a second staff user and confirm the badge moves → AC-1
- [ ] Joined and Sent dates read as `<day> <month> <year> (UTC)` whatever the browser locale → AC-1
- [ ] Paste a membership id from another agency into `changeTeamMemberRole` → `not_found`, nothing changes → AC-9
- [ ] In Clerk development, give an organization more than 100 memberships → every row renders on `/team`, and a member past row 100 can be re roled and removed → AC-1, AC-5, AC-6

## Acceptance-criteria coverage

- AC-1 · covered by the open page, member view, and value sourcing steps · AC-2 · the invitation walk (new person and existing account) · AC-3 · the duplicate invite step · AC-4 · the revoke step · AC-5 · the promote and demote steps · AC-6 · the remove step · AC-7 · the self demote and leave steps · AC-8 · the member view and the console call step · AC-9 · the foreign membership id step · AC-10 · `src/team/actions.test.ts` (mirror failure returns ok and logs at error level) · AC-11 · the wrong secret key steps · AC-12 · the removed person revisit step and `src/auth/context.test.ts` · AC-13 · the server log step · AC-14 · the locked controls, keyboard and axe steps · AC-15 · the `/settings` step
