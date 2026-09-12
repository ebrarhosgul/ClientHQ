# 0009. Client contacts and portal invitations: rationale

_The decision record behind [index.md](index.md). `/develop` reads the index; this file is for the humans asking why._

## Context

ClientHQ's client portal is a read only window for the agency's customers, and the whole portal rests on one link: a `client_contacts` row whose `user_id` points at a real Clerk user. Spec 0002 created the row with the invitation columns, spec 0003 built the resolver that turns that row into a contact context on every `/portal` request and reads a `clienthq_contact` cookie it expects this feature to write, and spec 0005 routes a person with an accepted row to `/portal`. Nothing yet creates a contact, sends anything, or sets `user_id`. Until it does, the portal has no users, and features 15 through 18 have nothing to show.

The forces are mostly about trust. The agency chooses who gets in by typing an email address, but the app has no way to know who is reading that mailbox: emails are forwarded, shared inboxes exist, and a link in an inbox outlives the moment it was sent. Whatever proves identity has to come from somewhere stronger than possession of the link. At the same time the database is a single shared PostgreSQL on Supabase with a one connection pool (spec 0001), so anything that holds a connection during a network call, or that needs a second store to count things, costs more than it looks. The product has no transactional email yet at all, and the scope row is explicit that this feature introduces it for the ones after.

There is also the scoping rule every read and write obeys: the tenant is resolved from the session or from the contact row, never from a request. Acceptance is the one moment a person has a session and no tenant, because the row that would give them one is exactly what they are trying to claim. That has to be handled without punching a hole in the rule.

Not deciding leaves the portal unreachable and pushes email infrastructure into feature 13, where it would be designed around invoices rather than around the simplest email the product sends.

## Options considered

### Option 1: Spec 0001's sketch as written: a signed token, Upstash limits, and the unscoped door

Follow the outline spec 0001 gave. The link carries the contact id and an expiry signed with `INVITE_TOKEN_SECRET`, and a hash of it is stored as well. Sends are rate limited through Upstash Redis with a sliding window. Acceptance runs through `withSystemAccess` by widening its ESLint exemption to the accept action's file. The email match is against the primary verified address only.

**Pros**:
- Already written down and agreed in principle; nobody has to re read anything.
- A signed token can be checked for expiry without a database read, which matters if the accept page were ever public.
- Upstash limits are precise across every serverless instance and survive a cold start.

**Cons**:
- Two secrets that must agree (the signature and the stored hash) where one check already decides; the signature adds a key to rotate and buys nothing once the row is read anyway, which it must be to bind.
- Upstash is a third provider, an environment variable and a network hop for a feature that sends a few emails a day; spec 0001 itself flagged this as a follow up to reconsider.
- Widening `withSystemAccess` puts raw unscoped access into application code and turns the isolation test's pinned list into a list that grows; the next widening is easier than this one.
- Primary email only refuses a person whose Google account address differs from the one they use for work, for no gain in safety since both are verified.

### Option 2: Opaque hashed token, Postgres counted limits, an explicit accept step, and a named door in the tenant layer

The link is `<contact id>.<32 random bytes>`; the row is fetched by primary key and the SHA-256 digest of the whole token is compared in constant time against the stored one. Expiry is a column. The cooldown and the daily cap are decided from `invited_at`, which is stamped only after Resend accepts the message. Acceptance is a page that inspects and a Server Action that binds, both calling functions in `src/db/tenant/invitation.ts` that take a token and read the organization off the row. The identity check is any verified email on the Clerk user. Email goes out through Resend with a React Email template and a console transport when no key is set.

**Pros**:
- One secret, short lived, never stored: a database dump yields digests only, and there is no signing key to leak or rotate.
- No new provider; the limits are one indexed query on a column that already exists.
- The acceptance door is narrow and typed: a token in, four possible outcomes out, no caller supplied ids. It lives in the directory the lint rule already exempts, so no fence moves.
- An explicit Accept button means a GET never writes, link prefetchers cannot bind, and the wrong account state can say so before anything happens.
- The console transport lets the whole flow run on a clone with no Resend account, which keeps the browser suite honest.

**Cons**:
- `invited_at` means "handed to the provider", a subtler definition than "sent", and the two phase write can leave a delivered email unstamped if the process dies in between (harmless, but real).
- The daily cap is check then write with no lock; two simultaneous senders can exceed it by one.
- A third named exit from the scoping rule exists, and a reviewer has to know it is deliberate.
- Resend needs a verified domain before production works, and a forgotten key in staging silently falls back to the console.

### Option 3: Let Clerk send the invitation

Use Clerk's own user invitations API: create an invitation for the contact's email with a redirect URL and the contact id in public metadata, let Clerk send the email from its own template, and bind the row when the invited person completes sign up, reading the contact id from the metadata on the new user.

**Pros**:
- No email provider, no template, no token code at all; Clerk hosts the email and the expiry.
- The identity check is built in: Clerk only completes the invitation for the invited address.

**Cons**:
- Clerk user invitations are for people who do not yet have a Clerk account. A contact who already signed up (as staff of another agency, or as a contact of a second client) cannot be invited this way at all, and spec 0001 is explicit that the same person can be both.
- The email lives in Clerk's dashboard, not the repository: no pull request review, no agency name in the display name, no reply to the account manager, and no reuse for the invoice emails that come next. The scope row's reason for this feature, introducing transactional email for later features, is not met.
- Binding on sign up completion means trusting metadata written at invite time and read at webhook time, two places for the contact id to go stale if the contact is removed in between.

## Rationale

Option 2 is chosen because every force in the Context points at it. The trust problem is solved by Clerk's verification, not by the link, and once that is true the link only needs to be unguessable and short lived; 256 random bits and a 7 day column do that, and a signature on top would be a second lock on a door whose key is elsewhere. The one connection pool is why the send is kept out of the transaction and why `invited_at` is stamped after the provider answers rather than before: the alternative is either holding the pool during a network call or a compensating write after a failed one, and neither is simpler than two statements. The scoping rule is honoured rather than widened: the acceptance functions read the organization from the row they fetch, which is the same shape as the contact resolver spec 0003 already wrote, so a reviewer who understands `resolveContactContext` understands `acceptInvitation`.

Option 1 was the plan on paper and is not wrong, but each of its three extra moving parts (a signing secret, a Redis provider, a widened exemption) was added before there was a reason for it, and spec 0001 itself doubted one of them. Option 3 is the fastest to ship and would be the right call for a product where invited people never already have an account; ClientHQ is explicitly not that product, and it would leave feature 13 to build email from nothing anyway.

Two of the engineer's picks deserve a note. "Any verified email" over "primary only" is a deliberate softening of spec 0001's wording: the safety comes from verification, and a person with two verified addresses on one account is one person. "Keep the pending invitation on a send failure" is why the stamp moved after the send: with the stamp before it, the cooldown would have blocked the very resend the error message recommends.

Decisions settled here rather than asked, with the runner up: the token shape puts the contact id in the link so the lookup is by primary key (runner up: a unique index on the digest; rejected as a second query shape for no safety gain). `invited_at` is the last successful hand off, not the last attempt (runner up: a separate `invite_sent_at` column; rejected as a column whose only job is the cooldown). The cookie is a plain contact id, `httpOnly`, `lax`, path `/`, one year (runner up: a signed cookie; unnecessary because spec 0003 re verifies the value against the user's own rows on every request, so a forged value selects nothing). The wrong account state shows the signed in address, not the invited one (runner up: show both; rejected because the link holder may not be the addressee). The daily cap is 50 distinct contacts and the cooldown 5 minutes (runner up: 20 and 1 minute; 50 covers a busy onboarding day for a larger agency and 5 minutes stops a double click without stranding a resend). The mirror `users` row is ensured on acceptance by extracting the user half of `ensureMirrorRows` (runner up: calling `ensureMirrorRows` with a placeholder organization; rejected because a contact has no membership to write). The idempotency key includes a digest prefix rather than a timestamp so that the same token retried is the same key and a resend is a new one (runner up: `invited_at` in the key; rejected because it is not yet stamped when the send runs).

## Operator notes: Resend domain verification

Recorded here so the build does not have to rediscover it. In the Resend dashboard, add the sending domain, publish the SPF and DKIM DNS records it shows, wait for the domain to show as verified, then create an API key with sending permission and put it in `RESEND_API_KEY`. `EMAIL_FROM` must be an address on that domain. Before verification, Resend's test domain only delivers to the address that owns the Resend account, which is enough to try the flow once but not to invite anyone else.
