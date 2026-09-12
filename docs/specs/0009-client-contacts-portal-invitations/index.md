# 0009. Client contacts and portal invitations

**Date**: 2026-09-12
**Status**: In Progress

## Summary

This settles how an agency puts a named person on a client record and lets that person into the client portal. Staff add a contact (a name and an email) on the client's page, then send an invitation email. The email carries a one time link; only a hash of that link's secret (a one way fingerprint, so a copy of the database cannot rebuild the link) is ever stored, and the link stops working after 7 days or when it is used. To accept, the person signs in or creates an account with Clerk, and the app checks that one of the verified email addresses on that account is the address the invitation went to. A forwarded link is therefore useless to anyone else. This is also the first feature that sends email, so it stands up the email sending piece that invoices and reminders reuse later.

## Requirements

**User stories**:
- As agency staff, I want to add the people I work with at a client to that client's record, so that who is who is on file.
- As agency staff, I want to invite a contact to the portal by email, resend if it never arrived, and revoke if I picked the wrong person, so that the right people get in and nobody else does.
- As agency staff, I want to remove a contact, so that someone who has left the client company loses their portal access.
- As an invited client contact, I want to open the link, sign in or create an account, and land in my portal, without any way for someone who was forwarded my link to take my place.
- As the operator, I want invitation sends bounded and invitation secrets unrecoverable from the database, so that a bug or a hostile account cannot burn the email quota or mint logins.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: Any agency staff member (admin or member) can add a contact to an active client from `/clients/[id]` with a name (required, trimmed, 1 to 200 characters) and an email (required, valid, trimmed, lowercased, at most 320 characters). The row is written with `org_id` from the caller's context, `client_id` from the page the form sits on and re checked against that organization, `user_id` null and no invitation fields set. A second contact with the same email on the same client is refused with `conflict` and an inline error beside the email field; the same email on a different client of the same agency is allowed. Adding to an archived client is refused with `conflict`.
- **AC-2**: Any staff member can edit a contact's name and email. Changing the email of a contact with a pending or expired invitation clears that invitation (`invite_token_hash`, `invite_expires_at`, `invited_at`, `invited_by_user_id` all set null), so the old link stops working. Changing the email of an accepted contact is refused with `conflict` and the message that the contact must be removed and added again; the edit form shows the email as read only for an accepted contact.
- **AC-3**: Any staff member can send an invitation to a contact that has no `user_id`, on an active client. Sending generates a token of the form `<contact id>.<32 random bytes, base64url>`, stores only the SHA-256 hex digest of the whole token in `invite_token_hash`, sets `invite_expires_at` to 7 days from now and `invited_by_user_id` to the caller's `users.id`, then sends the email, and only after the provider accepts it sets `invited_at` to now. The token appears in the email link and nowhere the app controls: not in the database, not in a log line the app writes, not in a Server Action argument beyond the accept action's own parsed input. (The hosting platform's request logs do record the accept URL; see Consequences for why that is accepted.) Resending (sending to a contact that already has a hash) issues a new token and expiry, and the previous link fails from that moment. Sending to an accepted contact or on an archived client is refused with `conflict`.
- **AC-4**: A send is refused with `rate_limited` when fewer than 5 minutes have passed since the contact's `invited_at` (the per contact cooldown; exactly 5 minutes is allowed), or when 50 or more contacts of the agency have an `invited_at` strictly inside the last 24 hours (the per agency daily cap; the 50th such row refuses). Both limits are decided from that column through the scoped accessor, with no other store. Because `invited_at` is stamped only after a successful hand off to the provider, a failed send never consumes the cooldown.
- **AC-5**: The email is a React Email template rendered to HTML and plain text, sent through the Resend SDK. Subject: `<Agency name> invited you to their client portal`. From: `EMAIL_FROM` with the display name `<Agency name> via ClientHQ`. Reply to: the inviting staff member's `users.email`. Body: the client name, the agency name, the accept link built from `NEXT_PUBLIC_APP_URL` + `/portal/accept?token=<token>`, and the expiry as a UTC calendar date. The send carries the idempotency key `client-invitation/<contact id>/<hash prefix, first 12 hex characters>`, so a retried call cannot deliver the same link twice. With `RESEND_API_KEY` unset in `development` or `test`, the transport logs the recipient, subject and link to the server console and reports success; in `production` the key is required at `env()` parse time.
- **AC-6**: When the provider refuses or fails the send (Resend returns an `error`, or the call throws), the row keeps the hash and expiry it was just given, `invited_at` is left as it was, the action returns `unavailable` with a message saying the email could not be sent, and the staff member's fix is a resend, which is not blocked by the cooldown. The row's badge then reads `Email not sent` when no send has ever succeeded for it (`invited_at` null, the `unsent` status), or `Invited until <date>` when an earlier send did succeed. The same `unsent` status covers a process that died between writing the hash and calling the provider, so a row never looks invited unless an email was actually handed off.
- **AC-7**: Any staff member can revoke a pending or expired invitation: `invite_token_hash`, `invite_expires_at`, `invited_at` and `invited_by_user_id` are set null, the contact returns to not invited, and the old link fails as invalid. Revoking a contact with nothing pending succeeds and changes nothing. Revoking an accepted contact is refused with `conflict`.
- **AC-8**: Any staff member can remove a contact, after a confirm dialog. The row is hard deleted. A pending link fails as invalid afterwards; an accepted contact loses portal access on their next request, because the contact resolver (spec 0003) finds no row for them. Removing a contact that no longer exists succeeds and changes nothing; the returned `id` is the `contactId` the caller passed in either case.
- **AC-9**: `/portal/accept?token=<token>` requires a session (the proxy sends a signed out visitor to sign in and back, and Clerk carries that return URL over to sign up, so a brand new person lands back on this page after creating an account). The page verifies the token without writing, using the same `parseToken` from `src/contacts/token.ts` the action uses: shape, row by the contact id in the token, digest equality in constant time, expiry in the future, `user_id` null, client not archived, and finally that at least one verified email on the signed in Clerk user equals the contact's email. It then renders one of exactly four states, with this copy: **acceptable** (heading `Accept your invitation`, body `<Agency name> has invited you to the client portal for <Client name>. You are signed in as <signed in email>.`, button `Accept invitation`), **already yours** (every check passes except `user_id`, which already equals this Clerk user: heading `You already accepted this invitation`, button `Go to your portal`, no write), **wrong account** (every check passes except the email match: heading `This invitation is for a different email address`, body `You are signed in as <signed in email>. Sign in with the address that received the invitation to accept it.`, link `Sign out and switch account`; the contact's address is never shown), or **invalid** (every other case, including a missing or malformed token, a missing row, a digest mismatch, an expired link, an archived client, and a row accepted by someone else: heading `This invitation link is not valid`, body `It may have expired, been replaced by a newer one, or already been used. Ask your agency to send a new invitation.`; one message for all of these, so nothing reveals which). The page never triggers acceptance on load.
- **AC-10**: The accept Server Action re runs every check from AC-9, requires that at least one email address on the signed in Clerk user with verification status `verified` equals `client_contacts.email` after lowercasing, ensures the `users` mirror row exists, and in one transaction sets `user_id` and `accepted_at` and clears `invite_token_hash` and `invite_expires_at`, guarded by `user_id is null` so two concurrent accepts cannot both bind. It then sets the `clienthq_contact` cookie to the contact id (`httpOnly`, `secure` outside development, `sameSite: lax`, path `/`, one year) and redirects to `/portal`. A contact already accepted by the same Clerk user sets the cookie and redirects with no write. Any other outcome returns `forbidden` and the page shows the invalid or wrong account state.
- **AC-11**: A forwarded link cannot claim someone else's contact: a signed in user with no matching verified email, any user after the link has expired, and any user other than the accepter after acceptance are all refused, and the row is unchanged in every case. Nothing in the refusal reveals the contact's email or whether the contact exists.
- **AC-12**: Every staff write in this feature runs through `withTenantAction()` with the subscription gate from spec 0008, so on `grace` or `locked` it is refused with `subscription_inactive` and the UI shows the refusal with a link to `/billing`. Acceptance is not a staff write and is allowed at every subscription level; what a contact then sees in the portal is feature 15's rule (spec 0008, Security model).
- **AC-13**: Every contact read and write is scoped through `tenantDb(ctx)`: a contact id or client id belonging to another agency resolves as `not_found` in every action, and a client contact context (a portal login) is refused by `requireStaff` on every action and redirected away from `/clients` by the proxy. The only reads of `client_contacts` outside a tenant context are the two named functions in `src/db/tenant/invitation.ts`, which take a token and derive the organization from the row they fetch, never from the caller.
- **AC-14**: The Contacts section on `/clients/[id]` lists the client's contacts with name, email, a status badge (`Not invited`, `Email not sent`, `Invited until <date>`, `Expired`, `Accepted`), an `Invited by <name> on <date>` line when `invited_at` is set (falling back to `Invited on <date>` when the inviter's user row is gone), and the actions that apply to that status. It has an inline add form, an empty state, and an error state, meets WCAG 2.2 AA in both themes (axe passes), and its states are added to `/design`. The accept page's four states meet the same bar.
- **AC-15**: Every send, send failure, revoke, remove and accept writes one structured log line carrying the organization id, the contact id and the outcome, and never the token, the digest or an email address.

## Decision

**Chosen option**: Option 2: Opaque hashed token with the contact id in the link, Postgres counted limits, an explicit accept step behind the existing proxy, and a named acceptance door inside the tenant layer.

Staff manage contacts on the client page through ordinary `withTenantAction()` writes; sending generates a random secret whose SHA-256 digest is the only thing stored, the email goes out through Resend with a React Email template and a console fallback when no key is set, limits are counted from `invited_at` with no new provider, and acceptance is an explicit Server Action that reads the row through `src/db/tenant/invitation.ts`, checks a verified Clerk email against the contact's email, binds the row, sets the contact cookie spec 0003 already reads, and lands the person on `/portal`. Full reasoning and the options weighed are in [rationale.md](rationale.md).

**Implementation skills**: `resend` (`resend/resend-skills`, `.agents/skills/resend/`) · `react-email` (`resend/resend-skills`, `.agents/skills/react-email/`) · `email-best-practices` (`.agents/skills/email-best-practices/`) · `clerk-nextjs-patterns` (`clerk/skills`, `.agents/skills/clerk-nextjs-patterns/`) · `zod` (`.agents/skills/zod/`) · `drizzle` and `drizzle-migrations` (`.agents/skills/drizzle/`, `.agents/skills/drizzle-migrations/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `shadcn` (`.agents/skills/shadcn/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `vitest` (`.agents/skills/vitest/`) · `playwright-cli` (`.agents/skills/playwright-cli/`)

## Feature design

**Data model sketch**:

One existing table changes; no table is added. `client_contacts` (tenant scoped, spec 0002) gains one column and one index.

| Column | Type | Null | Status | Meaning in this feature |
|---|---|---|---|---|
| `id` | uuid, PK | no | existing | The contact id carried as the first half of the token |
| `org_id` | uuid → `organizations`, cascade | no | existing | Stamped by `tenantDb` on staff writes; read off the row on acceptance |
| `client_id` | uuid → `clients`, cascade | no | existing | |
| `user_id` | uuid → `users`, set null | yes | existing | Set on acceptance. Non null means "this is a portal login" |
| `email` | text, lowercase CHECK | no | existing | Unique with `client_id`. The address the verified Clerk email must equal |
| `name` | text | no | existing | |
| `invite_token_hash` | text | yes | existing | SHA-256 hex of the whole token. Set on send, cleared on accept, revoke and email change |
| `invite_expires_at` | timestamptz | yes | existing | Generation time + 7 days. Set and cleared with the hash |
| `invited_at` | timestamptz | yes | existing | **The last time the provider accepted the email**, stamped after the send succeeds. Drives the cooldown, the daily cap and the "invited by ... on ..." line |
| `accepted_at` | timestamptz | yes | existing | |
| `invited_by_user_id` | uuid → `users`, set null | yes | **new** | The staff member who last sent it. Reply to and the "invited by" line. Cleared with the hash |
| `created_at`, `updated_at` | timestamptz | no | existing | |

New index: `client_contacts_invited_by_user_id_idx` on `invited_by_user_id`. Relationships: `clients` 1:N `client_contacts`; `users` 1:N `client_contacts` as the login (`user_id`); `users` 1:N `client_contacts` as the inviter (`invited_by_user_id`). `src/db/schema/relations.ts` gains the second `users` relation under the name `invitedBy`, and `src/db/schema/zod.ts` needs no change beyond the generated column.

The Drizzle table comment on `invited_at` must be updated to the meaning above, since it changes from "when the invitation was sent" to "when the provider accepted it".

**State transitions**:

Contact status is never stored. It is derived by one pure function `contactStatus(row, now)` in `src/contacts/status.ts`, in this order: `accepted` when `user_id` is set; else `unsent` when `invite_token_hash` is set and `invited_at` is null (a token exists but no email was ever handed off); else `invited` when the hash is set and `invite_expires_at` is after `now`; else `expired` when the hash is set; else `not_invited`.

```
not_invited ──send (hash written)──▶ unsent ──provider accepts──▶ invited ──7 days pass──▶ expired
     ▲                                  │                            │  ▲                      │
     │                                  │                            │  └──────resend──────────┘
     ├────revoke────────────────────────┴────────────────────────────┤
     ├────email edited──────────────────────────────────────────────┤
     │                                                               └──accept (verified email matches)──▶ accepted
     │                                                                                                          │
     └──────────────────────────── remove (hard delete, from any state) ◀───────────────────────────────────────┘
```

`unsent`, `invited` and `expired` all allow send (resend), revoke, edit and remove. `accepted` allows edit name only and remove. `not_invited` allows send, edit and remove. Acceptance is the only transition a non staff user can trigger; the token verifies from `unsent` as well as `invited`, since the link may have been delivered before the stamp was written, and the page and action check the hash and expiry, not the derived status.

**API surface**:

Staff actions live in `src/contacts/` and are `withTenantAction()` writes (`requireRole: "staff"`, subscription gated by default, each returning the project's `Result` shape). The accept action is outside the wrapper by necessity and is described separately.

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/clients/[id]` (Contacts section) | Server Component read | `id` from the path | the client's contacts ordered by name then id, each with derived status and the inviter's name | `requireStaff`, gated group | not found for a foreign or missing client (the page already does this) |
| `addContact` | Server Action | `clientId: uuid` (req), `name: string` (req), `email: string` (req) | `{ id }` | staff, full subscription | `validation`, `conflict` (duplicate email on the client, or archived client), `not_found` (foreign client), `subscription_inactive` |
| `updateContact` | Server Action | `contactId: uuid` (req), `name: string` (req), `email: string` (req) | `{ id }` | staff, full subscription | `validation`, `conflict` (duplicate, or email change on an accepted contact), `not_found`, `subscription_inactive` |
| `sendInvitation` | Server Action | `contactId: uuid` (req) | `{ id, expiresAt }` | staff, full subscription | `conflict` (accepted, or archived client), `rate_limited` (cooldown or daily cap), `unavailable` (provider failed; the row stays invited), `not_found`, `subscription_inactive` |
| `revokeInvitation` | Server Action | `contactId: uuid` (req) | `{ id }` | staff, full subscription | `conflict` (accepted), `not_found`, `subscription_inactive` |
| `removeContact` | Server Action | `contactId: uuid` (req) | `{ id }` | staff, full subscription | `not_found` is treated as success (already gone), `subscription_inactive` |
| `/portal/accept` | page, GET | `token` search param | one of four states: acceptable, already yours, wrong account, invalid | session required (proxy); no organization needed | a missing or malformed token renders invalid; nothing throws to the person |
| `acceptInvitation` | Server Action, not `withTenantAction` | `token: string` (req, parsed by Zod: `<uuid>.<43 base64url chars>`) | redirect to `/portal` with the `clienthq_contact` cookie set | signed in Clerk user, any organization state, any subscription level | `unauthenticated` (no session), `forbidden` (no verified email match, expired, revoked, accepted by someone else, archived client), `unavailable` (Clerk lookup failed) |
| `src/db/tenant/invitation.ts` · `inspectInvitation({ token, clerkUserId, verifiedEmails })` | layer function, read | the parsed token, the Clerk user id, that user's verified emails (lowercased) | `{ kind: "acceptable", contactId, clientName, agencyName, contactEmail }` · `{ kind: "already_yours", contactId }` · `{ kind: "wrong_account" }` · `{ kind: "invalid" }` | none; the row supplies the organization | throws only on a database failure |
| `src/db/tenant/invitation.ts` · `acceptInvitation({ token, clerkUserId, verifiedEmails, mirrorUser })` | layer function, write | as above plus the `MirrorUser` from Clerk | `{ kind: "accepted" \| "already_yours", contactId }` or `{ kind: "refused" }` | none; the row supplies the organization | throws only on a database failure |
| `src/email/send.ts` · `sendEmail(message)` | module function | `to`, `from`, `replyTo`, `subject`, `react`, `idempotencyKey` | `Result<{ id }>`; the console transport returns a fake id | server only | `unavailable` when Resend returns `error` or throws; never throws itself |

Pure modules with no side effects, each unit tested: `src/contacts/token.ts` (`generateToken(contactId)`, `hashToken(token)`, `parseToken(raw)`, `digestsMatch(a, b)` using `crypto.timingSafeEqual`), `src/contacts/limits.ts` (`cooldownRefuses(invitedAt, now)`, `dailyCapRefuses(recentSends, now)` with `COOLDOWN_MINUTES = 5`, `DAILY_CAP = 50`, `INVITE_TTL_DAYS = 7`), `src/contacts/status.ts`.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `addContact` | `org_id` | `ctx.orgId`, stamped by `tenantDb`, never the form |
| `addContact` | `client_id` and that the client is active | the `clientId` input, re read through `tenantDb` so a foreign id is `not_found`; `clients.archived_at` null |
| `addContact`, `updateContact` | the stored email casing and validity | the Zod schema in `src/contacts/schema.ts`: trim, lowercase, `z.email()`, max 320, mirroring `lowercaseEmail` in `src/db/schema/zod.ts` |
| `updateContact` | whether the email may change | derived: `user_id` null on the current row |
| `sendInvitation` | the token | `generateToken(contactId)`: the contact id, a dot, 32 bytes from `crypto.randomBytes` as base64url |
| `sendInvitation` | `invite_token_hash` | `hashToken(token)`: SHA-256 hex of the whole token string |
| `sendInvitation` | `invite_expires_at` | now + `INVITE_TTL_DAYS` (7), computed in the handler from the server clock |
| `sendInvitation` | `invited_by_user_id` | `ctx.userId` |
| `sendInvitation` | `invited_at` | the server clock, written only after `sendEmail` returns ok |
| `sendInvitation` | cooldown verdict | `invited_at` on the current row against `COOLDOWN_MINUTES` |
| `sendInvitation` | daily cap verdict | a scoped select of contacts with `invited_at` in the last 24 hours, `limit 50`; refused when 50 rows come back |
| `sendInvitation` | the agency name for the subject and display name | `organizations.name` through `agencyProfile(ctx)` from `src/db/tenant/organization.ts` |
| `sendInvitation` | the client name in the body | `clients.name` on the joined row |
| `sendInvitation` | the reply to address | `users.email` for `ctx.userId`, read through the membership relation from the scoped accessor |
| `sendInvitation` | the accept link | `env().NEXT_PUBLIC_APP_URL` + `/portal/accept?token=` + the token, URL encoded |
| `sendInvitation` | the expiry shown in the email | `invite_expires_at` formatted as a UTC calendar date, the same rule the spec 0008 grace banner uses |
| `sendInvitation` | the idempotency key | `client-invitation/<contactId>/<first 12 hex characters of the digest>`, so a new token is a new key and a retry of the same token is the same key |
| `sendInvitation` | which transport | `isEmailConfigured()` in `src/lib/env.ts`: Resend when `RESEND_API_KEY` is set, console otherwise |
| Contacts section | the status badge | `contactStatus(row, now)` with `now` from the server clock at render |
| Contacts section | "Invited by <name> on <date>" | `users.name` (falling back to `users.email`) through the new `invitedBy` relation, and `invited_at` as a UTC calendar date; when `invited_by_user_id` is null but `invited_at` is set, the line reads "Invited on <date>" |
| `removeContact` | the returned `id` | the `contactId` input, whether or not a row was deleted |
| `/portal/accept`, `acceptInvitation` | the parsed token | `parseToken` in `src/contacts/token.ts`, the single parser for both |
| `/portal/accept` | the copy of each state | pinned verbatim in AC-9 |
| `/portal/accept` | which of the four states | `inspectInvitation()`; the signed in email shown in the wrong account state is the Clerk user's primary email from `clerkUser()` |
| `/portal/accept`, `acceptInvitation` | the verified emails | `clerkVerifiedEmails(clerkUserId)` in `src/auth/clerk.ts`: every `emailAddresses` entry with `verification.status === "verified"`, lowercased |
| `acceptInvitation` | the `users` mirror row | `clerkUser(clerkUserId)` (existing) then `ensureUserRow(mirrorUser)`, the user half of `ensureMirrorRows` extracted in `src/db/tenant/provisioning.ts` |
| `acceptInvitation` | `accepted_at` | the server clock inside the transaction |
| `acceptInvitation` | the cookie value | the contact id from the row that was bound; the name comes from `CONTACT_COOKIE_NAME` in `src/db/tenant/session.ts` |
| `acceptInvitation` | where to land | `/portal`, fixed; spec 0005 already routes an accepted contact there |
| every action | the log line's ids | `ctx.orgId` and the contact id for staff writes; the row's `org_id` and id for acceptance |

**Key invariants**:
- A row with `user_id` set has `invite_token_hash` and `invite_expires_at` null: acceptance clears them in the same transaction that binds.
- `invite_token_hash` and `invite_expires_at` are both set or both null. `invited_at` and `invited_by_user_id` may be set while the hash is null only for an accepted row (history) and never for a not invited row.
- The token is never persisted: not in a column, not in a log, not in a Server Action argument that the framework might record. Only the digest and, transiently, the outgoing email carry it.
- At most one live link per contact. A resend replaces the digest, so exactly one token verifies at any moment.
- Binding requires `user_id is null` in the update's `where`, so two accepts of one link produce one binding.
- No staff action can set `user_id` or `accepted_at`. Only `acceptInvitation` in the tenant layer writes them.
- `invited_at` is stamped only after the provider accepts the message, so the cooldown and the cap count deliveries handed off, not attempts.
- Sending never runs inside an open transaction: the pool is capped at one connection (spec 0001), and a network call while holding it would stall every other request. The send action is declared without `transaction: true` and does its two writes as separate statements.
- The organization on an acceptance path is read off the fetched row. The caller never supplies it.
- The accept Server Action sits outside `withTenantAction`, so it owns its own error handling, and that handling must rethrow Next's `redirect()` signal (the `NEXT_REDIRECT` error) rather than converting it into a `Result`. Catch only the errors the action itself names.

**Security model**:

Staff side: every read and write goes through `tenantDb(ctx)` with `requireStaff(ctx)`; admin and member are equal here. The subscription gate applies to every staff write by default and none opts out. A contact context is refused by `requireStaff` and redirected by the proxy before `/clients` renders.

Acceptance side: the person is authenticated by Clerk but has no tenant yet. `src/db/tenant/invitation.ts` is the one place that reads a `client_contacts` row without a context, sits inside the directory `clienthq/no-raw-db-import` already exempts, and takes only a token: the row it fetches by primary key names the organization. Proof of identity is Clerk's email verification, never the link. Token entropy is 256 bits and the lookup is by primary key, so there is no scan to brute force and no timing side channel on the id; the digest comparison is constant time so there is none on the secret either. The page's refusal states do not reveal whether a contact exists or what its email is. The accept page is behind the proxy, so it is not a public endpoint and needs no separate rate limit.

Two things this design leans on outside the repository, both to be proven in build task 1 rather than assumed: the proxy's `redirectToSignIn({ returnBackUrl })` puts the accept URL in `redirect_url` on `/sign-in`, and Clerk's `<SignIn />` carries that `redirect_url` over to the `<SignUp />` link, so a person with no account creates one and still lands back on `/portal/accept` with the token. If that hand off does not survive on the real Clerk instance, the fallback is the public landing page option described in rationale.md (a public `/portal/accept` that shows explicit sign in and sign up links carrying the return URL itself), and the proxy's public list gains that one path; nothing else in this spec changes.

The token travels in a GET query string because an email link has to be a GET. The hosting platform's request logs therefore see the URL for as long as those logs are kept. That is accepted, not solved: the token lives at most 7 days, dies on first use, and on its own mints nothing, because binding still requires a verified Clerk email equal to the contact's. A path segment would be logged just the same, and a fragment would need JavaScript to read, so neither is an improvement.

Personal data: contact names and emails are ordinary business contact data, the same class spec 0006 handles; no new compliance scope. Email addresses and tokens are kept out of log lines (AC-15). Removing a contact hard deletes the row, which is also how a client's request to be forgotten is honoured for this table.

**Configuration required**:
- `RESEND_API_KEY`: the Resend API key. Optional in `development` and `test` (the console transport runs instead), required in `production`, enforced by a `superRefine` on the env schema.
- `EMAIL_FROM`: the bare sending address on a domain verified in the Resend dashboard, for example `invites@clienthq.example`. Required in every environment. The display name is composed per send.
- `NEXT_PUBLIC_APP_URL`: already declared; now actually read, for the accept link.
- Not added: `INVITE_TOKEN_SECRET`. Spec 0001 listed it for a signed token; the hashed random token needs no secret, and the variable is dropped from `.env.example`.
- Resend dashboard prerequisite: add and verify the sending domain (SPF and DKIM records), then create the API key. Until that is done, `EMAIL_FROM` must be an address on Resend's test domain, which only delivers to the account owner's own address.
- Clerk prerequisite: none new. Email with password already verifies the address with a code, and Google sign in returns a verified address; both are what AC-10 relies on.

**Critical test scenarios** (each maps to an acceptance criterion above):
- Happy path: staff add a contact on an active client, send the invitation, the console transport prints the link; a second browser signs up with Clerk using that email, is bounced to sign in and back to `/portal/accept?token=...`, sees the acceptable state naming the client and agency, presses Accept, lands on `/portal`, and the contact resolver picks that row on the next request, verifies **AC-1**, **AC-3**, **AC-5**, **AC-9**, **AC-10**.
- Failure case: `sendEmail` returns `unavailable`; the row keeps its hash and expiry, `invited_at` is unchanged, the action returns `unavailable`, the badge reads Email not sent on a first send and Invited after an earlier success, and an immediate resend is not refused by the cooldown, verifies **AC-4**, **AC-6**.
- Failure case: a resend issues a new digest; the first link's page now shows invalid and its accept action returns `forbidden` with the row unchanged, verifies **AC-3**, **AC-11**.
- Failure case: with `invite_expires_at` 7 days and one second ago, the page shows invalid and the action refuses with no write, verifies **AC-9**, **AC-11**.
- Failure case: two concurrent accepts of one link by the same user; one binds, the other reads `already_yours`, both land on `/portal`, and `accepted_at` is written once, verifies **AC-10**.
- Auth/permission: a signed in Clerk user whose verified emails do not include the contact's email sees the wrong account state naming only their own address, the action returns `forbidden`, and the row is unchanged, verifies **AC-9**, **AC-11**.
- Auth/permission: a user with the matching address present but unverified on their Clerk account is refused exactly like a mismatch, verifies **AC-10**.
- Auth/permission: after acceptance, a different signed in user opening the same link sees invalid; the accepter opening it sees already yours, verifies **AC-9**, **AC-11**.
- Auth/permission: agency B calls `sendInvitation`, `revokeInvitation`, `updateContact` and `removeContact` with agency A's contact id and gets `not_found` (remove reports success) with no change to A's row; a contact context calling any of the five gets `forbidden`, verifies **AC-13**.
- Auth/permission: with the agency's subscription row hand set to `past_due` 8 days ago, every staff action returns `subscription_inactive` and the section shows the `/billing` link, while acceptance of a link sent earlier still binds, verifies **AC-12**.
- Business rule: the 51st distinct contact invited within 24 hours is refused with `rate_limited`; a second send to one contact within 5 minutes is refused with `rate_limited`, verifies **AC-4**.
- Business rule: editing a pending contact's email clears the invitation and the old link fails; editing an accepted contact's email is refused, verifies **AC-2**.
- Business rule: archive the client, then send, add and accept are each refused, verifies **AC-1**, **AC-3**, **AC-9**.
- Tenancy: an accepted contact is removed; their next `/portal` request resolves `no_contact` and `/onboarding` takes over, verifies **AC-8**.
- Observability: the log lines for send, send failure, revoke, remove and accept carry ids and outcomes and contain no token, digest or `@`, verifies **AC-15**.
- Accessibility: the Contacts section in all five statuses, its empty and error states, and the accept page's four states pass axe in both themes; the confirm dialog before removal is keyboard reachable and announced, verifies **AC-14**.
- Idempotency: the rendered Resend call for one token always carries the same idempotency key, and a resend carries a different one, verifies **AC-5**.

## Build plan

Tracer Bullet: the first task stands the whole pipe up thin, from a form on the client page through a real email transport to a bound portal login, proven on a second Clerk account. Then the lifecycle is thickened, then the acceptance edges are closed, then the email and the screens are finished.

1. [x] **One thread end to end.** Generate and commit the migration adding `invited_by_user_id` (nullable, `references users.id on delete set null`) and its index to `client_contacts`; add the `invitedBy` relation and update the `invited_at` column comment. Add `RESEND_API_KEY` (optional outside production), `EMAIL_FROM` and `isEmailConfigured()` to `src/lib/env.ts` and `.env.example`, and drop `INVITE_TOKEN_SECRET` from the example. Install `resend`, `@react-email/components` and `@react-email/render`; write `src/email/send.ts` with the Resend transport and the console transport behind `isEmailConfigured()`, returning a `Result`. Write the pure modules `src/contacts/token.ts`, `src/contacts/limits.ts` and `src/contacts/status.ts` with their unit tests. Write `src/contacts/schema.ts`, `addContact` and a minimal `sendInvitation` (token, digest, expiry, inviter, send, then `invited_at`; no cooldown or cap yet), a minimal `src/email/templates/client-invitation.tsx` (subject, link, client and agency names), and a bare Contacts section on `/clients/[id]` with the add form and a Send button. Add `clerkVerifiedEmails()` to `src/auth/clerk.ts` and `ensureUserRow()` to `src/db/tenant/provisioning.ts`. Write `src/db/tenant/invitation.ts` with `inspectInvitation` and `acceptInvitation` (the `user_id is null` guard, one transaction), the `/portal/accept` page with only the acceptable and invalid states, and the `acceptInvitation` Server Action in `src/contacts/accept-invitation.ts` that parses the token, calls the door, sets the `clienthq_contact` cookie and redirects to `/portal`. Prove it on a real second Clerk account against the dev database, walking the brand new account path specifically: signed out, open the link, get bounced to sign in, switch to sign up, create the account, and confirm the browser lands back on `/portal/accept` with the token intact. If Clerk drops the return URL on that switch, apply the public landing page fallback named in the Security model before going further, satisfies **AC-1**, **AC-3**, **AC-5**, **AC-9**, **AC-10**, **AC-13**
2. [x] **The invitation lifecycle.** Add the cooldown and the daily cap to `sendInvitation`, the archived client and accepted contact refusals, the resend semantics test (old digest fails), and the send failure path that leaves `invited_at` untouched and returns `unavailable`. Build `updateContact` (clear the invitation on an email change, refuse an email change on an accepted contact), `revokeInvitation` and `removeContact` with the confirm dialog. Render the status badge from `contactStatus` (all five statuses, `unsent` included), the inviter line with its no inviter fallback, and the per status action set in the section. Every action revalidates `/clients/[id]`, satisfies **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-7**, **AC-8**, **AC-14**
3. [x] **Acceptance edges and the fence.** Add the already yours and wrong account states to `/portal/accept` (the wrong account state names the signed in address only and links to sign out), the unverified email refusal, the archived client refusal on both the page and the action, the concurrent accept test, the cross tenant tests for every staff action, the contact context refusals, the subscription gate tests (staff refused on `past_due`, acceptance still binds), and the structured log lines with the "no token, no digest, no `@`" test. Record `src/db/tenant/invitation.ts` in `src/db/AGENTS.md`'s key files on the next `/sync`, satisfies **AC-9**, **AC-10**, **AC-11**, **AC-12**, **AC-13**, **AC-15**
4. **The email, finished.** Complete the React Email template with the plain text render, the envelope (display name, reply to), the expiry date line, the idempotency key, and a unit test that renders it and checks the link, the key format and that the plain text part exists; enforce `RESEND_API_KEY` in production through the env `superRefine`; document the Resend domain verification steps in the spec's rationale for the operator, satisfies **AC-5**
5. **Screens and accessibility.** Empty and error states for the Contacts section, the `/billing` link on `subscription_inactive`, `/design` entries for the section's statuses and the accept page's four states, axe passes in both themes, and a Playwright walk of add, send (console transport), accept on a second account and land on `/portal`, satisfies **AC-12**, **AC-14**

## Consequences

**Positive**:
- The portal's front door exists: every later portal feature (15 onward) can assume a bound `client_contacts.user_id` and the cookie spec 0003 reads.
- Email sending is a reusable module with a Result shape, an idempotency key convention and a console fallback, so invoice sending (feature 13) and reminders (feature 18) add a template, not a transport.
- A database leak yields digests, not logins; a forwarded email yields a page that refuses; a lost email is fixed by a resend that kills the old link.
- One provider fewer: the Upstash follow up from spec 0001 is closed by counting from a column that already exists.
- No signing secret to rotate. The only secret in the design is 32 random bytes that live for at most 7 days.

**Negative / tradeoffs**:
- `invited_at` now means "handed to the provider", which is subtler than "sent" and must be read that way by the badge, the cooldown and any later report. The two phase write means a crash between the send and the stamp leaves a delivered email with no `invited_at`; the only effect is that the cooldown does not apply to the next resend and the cap undercounts by one, both harmless.
- The daily cap is checked then written without a lock, so two staff members sending at the same instant can exceed 50 by one. Accepted: the cap is a backstop against loops, not a hard quota.
- Acceptance adds a third named exit from the scoping rule alongside `unsafeTenantQuery` and `withSystemAccess`. It is narrow (a token in, one row out, organization off the row) and lives in the exempt directory, but it is one more thing a reviewer must know is deliberate.
- Resend must have a verified sending domain before production sends work, a dashboard task outside the repository, and the console transport can mask a misconfigured key in staging if someone forgets `RESEND_API_KEY` there.
- The platform's request logs record the accept URL, token included, for their retention window. Mitigated by the 7 day life, single use, and the verified email requirement, not eliminated. Anyone with read access to Vercel's logs should be treated as able to see live invitation links for that window.
- The brand new account path depends on Clerk carrying `redirect_url` from sign in to sign up. Task 1 proves it; if it fails, the accept page becomes public with explicit links, which is a small change but one more public route.
- A contact whose email is changed after acceptance cannot be edited in place; staff must remove and re add, which sends a new invitation. Chosen so the stored email always matches the verified one that bound the login.

**Neutral**:
- One migration: one nullable column and one index on an existing table. No backfill.
- Three new packages (`resend`, `@react-email/components`, `@react-email/render`) and two new environment variables; one variable spec 0001 planned (`INVITE_TOKEN_SECRET`) is never introduced.
- A new feature folder `src/contacts/` and a new infrastructure folder `src/email/`.
- Spec 0001's invitation sketch is refined rather than followed verbatim: the token is opaque rather than signed, any verified email counts rather than the primary only, and limits are counted in Postgres rather than Upstash. The next `/sync` should note this against spec 0001.

## Follow-up

- [ ] Feature 15 (client portal) owns the contact switcher for a user with several `client_contacts` rows and the locked agency page; this feature sets the cookie once, on acceptance, and never offers a switch.
- [ ] Feature 13 (invoice authoring) reuses `src/email/send.ts` and the template folder for the "invoice sent" email; the idempotency key convention `<event>/<entity id>/<version>` set here should be followed there.
- [ ] `resend`, `react-email` and `email-best-practices` conventions are not yet captured in a context file. `src/email/AGENTS.md` should hold them (the Result shape, the idempotency key rule, the console transport, the "never log an address" rule) before feature 13 begins, with a one line pointer from the root; do not add them to the root itself.
- [ ] When `/sync` runs: add `src/db/tenant/invitation.ts` to the key files table in `src/db/AGENTS.md` as the third named exit, and note against spec 0001 that `INVITE_TOKEN_SECRET` and the Upstash rate limit were dropped by this spec.
- [ ] Spec 0003's `## Follow-up` line about the cookie ("setting and switching belongs to features 10 and 15") can be ticked for the setting half once task 1 lands.
- [ ] Consider a scheduled sweep that nulls `invite_token_hash` and `invite_expires_at` on rows expired for more than 30 days, so stale digests do not sit forever. Not needed for correctness (an expired digest never verifies); tidy only. The daily cron route from feature 18 is the natural home.
- [ ] Feature 19 (rate limiting) lists invitation sends as one of its two ceilings. This spec settles that half with the Postgres counted cooldown and daily cap, so feature 19 keeps upload URL signing (and the agency creation gap spec 0005 deferred) and should decide whether those follow the same column counting pattern or need a shared limiter.
- [ ] If the operator ever wants "invitation opened" or "delivered" signals, Resend webhooks can supply them; nothing here depends on them, so they stay out until a feature asks.

## Rationale

Reasoning and the options weighed: see [rationale.md](rationale.md).
