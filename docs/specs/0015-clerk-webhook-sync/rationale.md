# 0015. Clerk webhook sync: rationale

_The decision record behind [index.md](index.md). `/develop` reads the index; this file is for the human who wants the why._

## Context

Spec 0001 made Clerk the owner of every agency, person and membership, and spec 0002 built three local tables that mirror them so pages can join on names and render member lists without a Clerk API call per row. Today those tables have exactly two writers: onboarding (spec 0005), which writes the creator's three rows when an agency is made, and the `no_mirror_row` repair, which puts the rows back when a signed in person finds them missing. Both cover absence. Neither covers change. An agency renamed in Clerk keeps its old name on `/dashboard`; a colleague removed in Clerk stays in the member list; a person who deletes their account keeps their name, email and avatar in `users` indefinitely. Feature 16 (team members) is about to build screens on top of that member list, so the mirror has to start moving before it becomes visibly wrong.

The forces are mostly already settled by the code around this feature. Spec 0007 shipped a webhook handler for Stripe with a specific six step order (verify, resolve, re read, ledger, lock and apply, commit) and a specific status discipline (`500` only when a retry might help, because a provider disables an endpoint that keeps failing). Spec 0002 built the `processed_webhook_events` ledger with a `source` column that already accepts `'clerk'`. Spec 0003 fenced the unscoped database door to three route files, one of which is this one, and its test fails if that list drifts. Spec 0005 chose upserts on unique keys for every mirror write precisely so a second writer could arrive without a conflict, and flagged that the two writers must agree on every column. `src/lib/scrub.ts` already knows how to erase a person without breaking the rows that point at them. The proxy already lets `/api/webhooks/*` through without a session. The shape of the answer is heavily constrained before a line is written.

Two forces are not settled by existing code. Clerk, like Stripe, does not promise delivery order, and it delivers through Svix with a retry schedule that stretches over days, so any design has to be honest about a late, repeated or lost event. And the scope's own "done when" asks for deletions that soft delete rather than destroy, and for an event missed during a deploy to be recovered without a person touching the database. The second of those has a subtlety: Vercel deploys are zero downtime and Svix retries a failed delivery for days, so "missed during a deploy" is mostly a solved problem; the real gap is staleness that produces no event at all, which no webhook can see.

Not deciding means feature 16 builds a member list from a table that only ever grows and never corrects, and every agency's first rename becomes a support conversation. The personal data angle is sharper: a person who deletes their Clerk account has a reasonable expectation that this product stops holding their email, and today nothing honours it.

## Options considered

### Option 1: Trust the payload, last write wins

The route verifies the signature, parses the full event payload, and writes its fields straight into the mirror. Deletes are applied from the `*.deleted` events. This is the shape most Clerk tutorials show, including the installed `clerk-webhooks` skill's examples.

**Pros**:
- No Clerk API calls at all; the handler is one verify and one upsert.
- Smallest amount of code and the easiest to explain.

**Cons**:
- Wrong the first time two updates for the same object arrive out of order: the mirror shows the older name until the next change, and nothing ever notices.
- A membership deleted then recreated for the same person is two events with no shared key in this schema (the table is keyed on the pair, not Clerk's membership id); a late `deleted` silently removes the new row.
- Breaks the ordering rule spec 0001 wrote down for exactly this situation and that spec 0007 implemented: the event is a signal that something changed, never the source of what it changed to.

### Option 2: Re read from Clerk on every event, on the Stripe webhook's six step shape (chosen)

The route verifies, parses only identifiers from the payload, re reads the named object from the Clerk backend API outside the transaction, then claims the `svix-id` in the ledger, locks the affected row and writes whatever Clerk holds now: present means upsert, gone means the delete path. The same rule for all eight events, deletes included, so the handler branches on object kind and not on event type. Mirror writes reuse provisioning's statements.

**Pros**:
- Out of order delivery is harmless by construction; a lost delete is healed by the next event about that object.
- Identical in shape to `src/payments/webhook.ts`, so one pattern, one set of tests to copy, one status discipline.
- Each column keeps a single writing statement, shared by onboarding and the webhook.
- Needs no schema change.

**Cons**:
- One Clerk API call per delivery (three when a membership arrives for rows that do not exist yet). Bursts queue behind Clerk's rate limits, and a 429 becomes a `500` and a Svix retry.
- A deleted event still pays for a re read that is known to return 404, purely for uniformity.
- The handler depends on the Clerk backend API being up; a Clerk outage means retries rather than degraded writes, which is right but slower.

### Option 3: Version by the payload's `updated_at`

Trust the payload, but add a `clerk_updated_at` column to the three mirror tables and only apply an event whose `updated_at` is newer than the stored one. Deletes carry no timestamp, so they apply unconditionally.

**Pros**:
- No API calls, and ordering between updates is handled correctly.
- Cheap to run, and the column doubles as a debugging aid.

**Cons**:
- A migration adding three columns, and both writers (onboarding reads the object from Clerk, the webhook reads it from the payload) have to agree on a clock and on setting the column, or the guard misfires.
- Does nothing for the deleted then recreated membership case, or for a delete that is lost outright.
- Two idempotency mechanisms in the codebase (a ledger and a version column) for what spec 0007 already solved with one.

### Option 4: No webhook; poll and repair instead

Skip the route. Keep the session claim authoritative, keep the `no_mirror_row` repair, and add a nightly job that lists everything from Clerk and rewrites the mirror. Deletions are discovered by the sweep.

**Pros**:
- No public endpoint, no signature secret, no ledger rows.
- The sweep is needed anyway for staleness (feature 18), so this builds one thing instead of two.

**Cons**:
- A rename or a removal takes up to a day to show, which feature 16's member management would make embarrassing within minutes of shipping.
- A deleted account's personal data lingers for up to a day, which is the wrong direction for erasure.
- Listing every organization and membership nightly is a growing number of paged Clerk calls, and the sweep becomes the load bearing writer of the mirror rather than a safety net.

## Rationale

Option 2 is chosen because the forces in Context are almost all about consistency with things already built. Spec 0001 wrote down the ordering rule, spec 0007 implemented it, and the ledger, the fence, the upserts and the scrub helper were each built with this webhook as their second consumer. Choosing the trusting shape of Option 1 would mean two webhook handlers in one small codebase that disagree about whether a payload is trustworthy, and it fails on the one ordering case (a membership removed and re added) that this schema cannot key. Option 3 fixes ordering for updates but not for deletes and buys it with a migration and a second idempotency mechanism. Option 4 is the right complement, not the right primary: a nightly sweep is where staleness without an event belongs, and that is exactly what this spec hands to feature 18.

The uniform "re read everything, deletes included" rule is deliberate. It costs one predictable 404 per delete and in return the handler has one path per object kind instead of two per event type, the lost delete case heals itself, and the membership case is handled by asking Clerk whether the pair still exists rather than by reasoning about which event came first. The engineer's answers during design pulled in the same direction: keep the slug rule onboarding already has, hard delete memberships as spec 0001 said, re read the organization and user when a membership names rows that do not exist, and apply a 404 on re read as the delete.

The one place this spec narrows spec 0001 is `user.created`. The engineer chose to mirror only people the product already knows, on data minimisation grounds. A brand new Clerk user can never already have a local row, so subscribing to `user.created` would only ever produce ignored deliveries; the subscription is dropped rather than left as noise. Rows still get created everywhere they are needed: onboarding, invitation acceptance, and a membership event, which proves the person belongs to an agency.

Two calls the engineer made explicitly are worth recording as product decisions rather than technical ones. First, `organization.deleted` does not touch Stripe. An identity event should not move money, and a Stripe call inside this handler would let a Stripe failure decide whether Clerk retries an identity change; the log line and the feature 18 reconcile are the honest version of that boundary. Second, a deleted person's client contact goes back to not invited rather than staying bound to a row nobody can sign in as, so the agency can re invite whoever replaces them without deleting and recreating the contact.

## Decisions settled while writing

These were left to the spec rather than asked, each with the runner up:

- **Ledger key is the `svix-id` header.** The Clerk payload carries no event id; `svix-id` is the message id, stable across retries, and it is what the installed `clerk-webhooks` skill names for deduplication. Runner up: a hash of the raw body, which would treat a legitimately resent message with a new id as a duplicate and a byte level difference in a retry as new.
- **The secret is passed explicitly.** `verifyWebhook(request, { signingSecret })` with the value from `env()`, rather than relying on the SDK reading `process.env` itself, so the project's env rule holds without an exception. Runner up: let the SDK read it, which works but leaves a required variable outside the schema's reach at request time.
- **The handler lives in `src/auth/`**, beside the Clerk backend wrapper, in three files that mirror `src/payments/` (`webhook.ts`, `webhook-events.ts`, `webhook-log.ts`). Runner up: under `src/db/tenant/` next to provisioning, which would put provider parsing inside the data access layer.
- **Mirror writes stay in `src/db/tenant/provisioning.ts`**, which grows named functions for the delete paths. The handler receives the unscoped handle from the route and passes it down as the executor. Runner up: inline the statements in the handler, which would give the mirror two definitions of every column, the exact flicker spec 0005 warned about.
- **The write is the lock.** Spec 0007 issues a `select ... for update` before applying, which works because a subscription event always names an organization that exists. Here a membership event can name rows that do not exist yet, and there is nothing to lock. So the upsert or update of the organization or user row is itself the lock (PostgreSQL locks the row an `insert ... on conflict do update` or an `update` touches until commit), and membership writes run after those two upserts. Runner up: an advisory lock keyed on the Clerk id, which also covers missing rows but adds a second locking idiom for a race the unique constraints already resolve. This was a cross check finding; the first draft copied the Stripe lock verbatim.
- **`ensureUserRow` refuses to rewrite a scrubbed row on its own.** A `setWhere: isNull(users.deletedAt)` on its conflict update and a named `MirrorUserDeleted` error when nothing comes back, so AC-8 does not rest on each caller remembering to check. Also a cross check finding. Runner up: leave the guard to callers, which is how it stands today and which works only until the next caller forgets.
- **Table order inside a transaction is organization, user, membership**, the order `upsertMirror()` already uses, so the webhook and onboarding cannot deadlock against each other.
- **A parse failure is a `500`**, as in spec 0007: it means Clerk's shapes moved under this code and deserves loud retries, not a quiet 200.
- **No rate limiting on the route.** Every request past the signature check is Svix's; the check itself is the ceiling.

## Amendments to earlier specs

- **Spec 0001**, the Clerk events consumed: `user.created` is no longer subscribed; `user.deleted` also unbinds the person's client contacts. An amendment note is added to spec 0001's line.
- **Spec 0003 / spec 0014**, contact resolution: `resolveContactContext` now requires the organization to be live, the same predicate spec 0005 added for staff.
