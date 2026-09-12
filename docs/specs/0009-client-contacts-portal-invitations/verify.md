# Verify: client contacts and portal invitations · spec 0009 · updated 2026-09-12 · verified 2026-09-12

_Steps derived from spec 0009 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

You need: the dev server with Clerk keys (`corepack pnpm dev`, no `RESEND_API_KEY`, so emails print to the server console), one agency account with an active subscription, and a **second Clerk account** whose verified email you control (a plus address on your own inbox works). The first account is called "staff" below and the second "the contact".

_Run on 2026-09-12 against the dev server (real Clerk session, real Supabase dev database, console email transport; a second dev server with an invalid `RESEND_API_KEY` and a changed `NEXT_PUBLIC_APP_URL` for the failure and link origin steps). 31 of 37 steps ran and passed. The six left unticked need a second Clerk account, a contact only session, or a change to the Clerk account itself, none of which exist in this environment: the brand new account walk (the signed out bounce to `/sign-in?redirect_url=` with the token intact was confirmed over plain HTTP, the sign up switch was not), the same link as a different Clerk user, the unverified email refusal, the removed contact's bounce to `/onboarding`, the live cross tenant calls, and the contact on `/clients`. Each of those is covered by `contacts.db.test.ts` or `src/proxy.test.ts`, which passed. The acceptance walk was driven with the staff account's own verified email as the contact, which the acceptance door allows; the `clienthq_contact` cookie is set in `accept-invitation.ts` but its attributes were not observable through the browser tools (httpOnly), so the binding was proven from the row and the `accept` / `accepted` log line instead. The daily cap step is worded one off: with 49 recent sends the 50th is allowed and the 51st refused, which is what spec 0009 line 184 and `dailyCapRefuses` both say._

## UI / manual

### Add and send (staff)

- [x] Open `/clients/<an active client>`. The page ends with a **Contacts** section: heading, description, `0 contacts`, the dashed empty state ("No contacts yet") and the inline add form (Name, Email, Add contact) → AC-14
- [x] Add a contact with a name padded with spaces and an email in mixed case (`  Ada  ` / `Ada@Example.COM`). The row appears as `Ada` / `ada@example.com` with the chip `Not invited` and the actions Send invitation, Edit (pencil), Remove (bin) → AC-1, AC-14 (Value sourcing: email casing)
- [x] Add the same email again with different casing. Refused with an error beside the Email field, values kept, no row added. Add it on a different client of the same agency: allowed → AC-1
- [x] Archive a client, open it. The section shows no add form and no Send buttons, with the archived note → AC-1, AC-3
- [x] Press **Send invitation**. The chip becomes `Invited until <date 7 days from today> (UTC)` with the line `Invited by <your name or email> on <today> (UTC)` beneath it, and the actions become Resend, Revoke, Edit, Remove → AC-3, AC-14 (Value sourcing: `invited_by_user_id`, `invited_at`)
- [x] In the server console find the `[email] console transport` block. Check: `To:` the contact's email, `From: "<Agency name> via ClientHQ" <EMAIL_FROM>`, `Reply-To:` your own email, `Subject: <Agency name> invited you to their client portal`, `Key: client-invitation/<contact id>/<12 hex>`, the link `NEXT_PUBLIC_APP_URL/portal/accept?token=<contact id>.<43 chars>`, and the expiry as `<date> (UTC)`. Change `NEXT_PUBLIC_APP_URL` in `.env`, restart, resend after five minutes: the link's origin follows it → AC-5 (Value sourcing: agency name, reply to, accept link, expiry, idempotency key)
- [x] Beneath the email block one JSON line: `{"event":"contacts.invitation","operation":"send","outcome":"sent","orgId":...,"contactId":...}`. It contains no `@`, no token and no 64 hex digest → AC-15
- [x] Press **Resend** within five minutes: refused with "An invitation went to this contact less than five minutes ago", no new email. After five minutes: a new email with a **different** token and a **different** `Key`, log outcome `resent` → AC-3, AC-4 (Value sourcing: cooldown)
- [x] Open the **first** (older) link while signed in as the contact: `This invitation link is not valid` → AC-3, AC-11
- [x] Set `RESEND_API_KEY` to an invalid value, restart, send to a fresh contact. The row shows `Email not sent` with the action **Send again**; the error under the button says the email could not be sent; the log line is `send_failed` / `provider_refused`. Send again straight away: not refused by the cooldown. Unset the key → AC-6 (Value sourcing: `invited_at` only after success)
- [x] Insert 49 contacts with `invited_at` inside the last 24 hours (or send 49 real ones): the 50th send is refused with the daily allowance message; a stamp older than 24 hours no longer counts → AC-4 (Value sourcing: daily cap)

### Edit, revoke, remove (staff)

- [x] Edit an invited contact and change the email. The dialog warns the invitation is cancelled; afterwards the chip is `Not invited`, and the previous link shows invalid → AC-2 (Value sourcing: whether the email may change)
- [x] Edit an invited contact and change only the name: chip and invited line unchanged → AC-2
- [x] Edit an accepted contact: the Email field is read only and the dialog says why; the name still saves → AC-2
- [x] **Revoke** an invited contact: chip back to `Not invited`, Revoke gone, the old link invalid, log line `revoke` / `revoked`. Revoke is not offered on `Not invited` or `Accepted` → AC-7, AC-14
- [x] **Remove** opens a confirm dialog naming the contact (keyboard: Tab reaches it, Escape closes it, focus returns to the bin button). Confirm: row gone, count down by one, log line `remove` / `removed`; the old link invalid → AC-8, AC-14, AC-15
- [ ] Remove an **accepted** contact, then as that contact reload `/portal`: `/onboarding` takes over (no contact row) → AC-8

### Accept (the contact)

- [ ] Signed out in a fresh browser profile, open the newest link. You land on `/sign-in?redirect_url=<the accept URL, token intact>`. Switch to **Sign up** from that screen and create the second account with the contact's email. After verification you land back on `/portal/accept?token=...`, not on `/onboarding` → AC-9 (the brand new account path; if the token is lost on the sign up switch, the spec's public landing page fallback applies)
- [x] The page reads `Accept your invitation` / `<Agency> has invited you to the client portal for <Client>. You are signed in as <contact email>.` with one button `Accept invitation`. Nothing was written yet: as staff, the chip still says `Invited until` → AC-9
- [x] Press **Accept invitation**. You land on `/portal`; the browser holds a `clienthq_contact` cookie (httpOnly, SameSite Lax, path `/`, one year, Secure outside development) whose value is the contact id; as staff the chip is `Accepted` with Edit and Remove only; the server log line is `accept` / `accepted` → AC-10, AC-14, AC-15 (Value sourcing: cookie value, landing)
- [x] Open the same link again as the contact: `You already accepted this invitation` with `Go to your portal`; pressing it lands on `/portal` with no change to the row → AC-9, AC-10
- [ ] Open the same link as **staff** (a different Clerk user): `This invitation link is not valid` → AC-9, AC-11
- [x] Send a new invitation to a contact whose email is **not** on the staff account, open it as staff: `This invitation is for a different email address` / `You are signed in as <staff email>. ...` with `Sign out and switch account`; the contact's address is nowhere on the page; pressing the button signs out and returns to sign in with the accept URL as `redirect_url` → AC-9, AC-11 (Value sourcing: signed in email)
- [ ] Add the contact's address to the staff Clerk account **without** verifying it, open the link: still the wrong account state. Verify it, reload: acceptable → AC-10 (Value sourcing: verified emails)
- [x] Set `invite_expires_at` on a pending row to a minute ago (SQL): the page shows invalid; put it back in the future and archive the client: still invalid → AC-9, AC-11
- [x] Tamper with the token in the URL (change one character of the secret, or the contact id): invalid; `?token=` missing or garbage: invalid, never an error page → AC-9

### Fence and gate

- [ ] As a member of a second agency, call `sendInvitation`, `revokeInvitation`, `updateContact` and `removeContact` with the first agency's contact id (from a test or the browser console): `not_found` (remove reports success), and the first agency's row is unchanged. `addContact` with the first agency's client id: `not_found` → AC-13
- [ ] Signed in as an accepted contact, open `/clients`: redirected away by the proxy → AC-13
- [x] Set the agency's subscription to `past_due` with `past_due_since` 8 days ago. Every Contacts action returns "subscription needs attention" with the **Go to billing** link; a link sent earlier still accepts and binds → AC-12

### Accessibility

- [x] `/design` → the **Client contacts** and **Accept invitation** sections show every status and all four states in both palettes; `corepack pnpm test:e2e` axe passes over the page → AC-14
- [x] On a real client page, Tab through the section: every control has a visible ring, every icon button announces the contact's name ("Edit Ada", "Remove Ada"), the status is read as words, the add form's errors are announced (role alert) and pointed at by `aria-describedby`, and at 320px nothing scrolls sideways except the table inside its own container → AC-14
- [x] Zoom to 200 percent: the section and the accept page stay usable → AC-14

## Commands

- [x] `corepack pnpm vitest run src/contacts` → the pure modules, the message composition, the section and accept page components with axe in both themes → AC-3, AC-4, AC-5, AC-9, AC-14
- [x] `corepack pnpm vitest run src/contacts/contacts.db.test.ts` (needs `DIRECT_URL`) → the five actions and the acceptance door against real PostgreSQL: limits, resend, send failure, edit rules, revoke, remove, binding and the already yours re read, the cross tenant and contact context refusals, the gate with acceptance left open, and the log lines with no `@`, token or digest → AC-1 to AC-4, AC-6 to AC-8, AC-10 to AC-13, AC-15
- [x] `corepack pnpm vitest run src/lib/env.test.ts` → `EMAIL_FROM` required everywhere, `RESEND_API_KEY` required only in production → AC-5
- [x] `corepack pnpm playwright test e2e/contacts.spec.ts e2e/design-gallery.spec.ts` → the accept page's no Clerk state, every gallery state under axe in both themes, action targets at or above 24 pixels → AC-14
- [x] `corepack pnpm db:schema:assert` and `corepack pnpm db:migrate:check` → `invited_by_user_id`, its index and its `set null` foreign key are live and the migration is committed → AC-3

## Acceptance-criteria coverage

- AC-1 add, duplicate, archived, foreign client · AC-2 edit rules · AC-3 send, resend, token shape, refusals · AC-4 cooldown and cap · AC-5 the email and the key · AC-6 the failed send and `unsent` · AC-7 revoke · AC-8 remove · AC-9 the four states and the sign in bounce · AC-10 binding, cookie, redirect, verified email · AC-11 the forwarded link · AC-12 the gate · AC-13 the fence · AC-14 the section and its states, axe · AC-15 the log lines
- Not automated: the brand new account walk (AC-9, needs a second Clerk account) and the removed contact bounce to `/onboarding` (AC-8); both are manual steps above.
