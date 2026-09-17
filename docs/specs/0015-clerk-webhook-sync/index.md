# 0015. Clerk webhook sync

**Date**: 2026-09-17
**Status**: Proposed

## Summary

Clerk (the sign in provider) owns every agency, person and membership in this product, and the database keeps a local copy of the three so pages can render names and member lists with a join. This spec adds the one route that keeps that copy current: Clerk sends a signed event whenever something changes, the route verifies it, looks the object up again in Clerk to learn what is true right now, and writes that. It reuses the six step shape spec 0007 built for Stripe (verify, resolve, re read, ledger, lock and apply, commit) so a replayed or out of order delivery is harmless, and it never creates a row for a person the product has not met. Deletions soft delete the agency or person, remove memberships, and hand a deleted person's client contact back to "not invited". Nothing here touches Stripe, and staleness that slips past the webhook is left to the nightly sweep in feature 18.

## Requirements

**User stories**:
- As agency staff, I want the agency name, my colleagues' names and the member list to match what is in Clerk, so that a renamed agency or a removed colleague shows correctly without anyone touching the database.
- As a person who deleted my Clerk account, I want my name, email and avatar gone from the product's mirror and my client access ended, so that the product holds nothing about me it no longer needs.
- As the operator, I want a replayed, out of order or failed delivery to be harmless, so that the mirror never freezes or flickers and I never repair it by hand.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `POST /api/webhooks/clerk` reads the raw request body and verifies it with `verifyWebhook` from `@clerk/nextjs/webhooks`, passing `signingSecret` from `env().CLERK_WEBHOOK_SIGNING_SECRET`. A missing or wrong signature answers `400` with outcome `unverified`, reads nothing from the body, and writes nothing, ledger row included.
- **AC-2**: The route acts on exactly eight event types: `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated` and `organizationMembership.deleted`. Any other verified event, `user.created` included, answers `200` with outcome `ignored` and writes nothing. The Clerk dashboard endpoint subscribes to those eight and no others.
- **AC-3**: Every acted on delivery is recorded in `processed_webhook_events` with `source = 'clerk'` and `event_id` equal to the `svix-id` header, inserted with conflict do nothing inside the same transaction as the mirror change. A replayed delivery answers `200` with outcome `duplicate` and changes nothing. The ledger row and the mirror change commit together or not at all, so a delivery that fails leaves no ledger row and Clerk's retry is processed rather than skipped.
- **AC-4**: Every acted on event, deletes included, re reads the object it names from the Clerk backend API outside any transaction and applies what Clerk says now: an object that is present is upserted, an object that is gone (a `404`, or an empty membership list for that organization and user) takes the delete path. No column is ever written from the event payload; the payload supplies identifiers only. Two `user.updated` deliveries for the same person applied in reverse order leave the mirror holding Clerk's current name.
- **AC-5**: An organization present in Clerk is upserted on `clerk_org_id` with `name` and `updated_at`. On insert the `slug` comes from the same `freeSlug()` helper onboarding uses; `slug` and `deleted_at` are never in the update set. The statement is the one provisioning already runs, held in one shared function, so the two writers cannot disagree.
- **AC-6**: An organization gone from Clerk gets `deleted_at` set to the database clock (an existing value is kept), its `memberships` rows hard deleted, and one log line naming the organization id and the local `subscriptions.status` for it (or `none`), that status read inside the same transaction after the organization update so the logged value is the one that commits. The delete branch calls `logClerkWebhook()` itself with outcome `handled` and reason `organization_deleted`, because the shared dispatcher logs only outcomes other than `handled`. The handler makes no Stripe call. A second delivery for an already soft deleted organization answers `200` handled and changes nothing. The explicit membership delete is required: a soft delete is an `UPDATE`, so the `memberships` cascade never fires.
- **AC-7**: `resolveContactContext` in `src/db/tenant/context.ts` treats an accepted `client_contacts` row whose organization has `deleted_at` set as absent, so a contact of a deleted agency resolves as `no_contact`, every portal page and both file routes refuse them through the spec 0014 ladder, and the client switcher lists no row from a deleted agency. The shape is pinned: a second left join to `organizations` on `client_contacts.org_id` selecting `deleted_at`, folded into the existing `owned` filter beside `contactId !== null`; the outer `users` query is untouched, so a person with no mirror row is still told `no_mirror_row` and not `no_contact`.
- **AC-8**: A user present in Clerk who already has a `users` row (matched on `clerk_user_id`) is updated through `ensureUserRow` with the lowercased `email`, `name`, `image_url` and `updated_at`. A user with no local row answers `200` with outcome `ignored` and no row is created. A local row with `deleted_at` set is never revived or rewritten; the event answers `200` with outcome `refused` and reason `user_deleted`. As defence in depth, `ensureUserRow` itself gains `setWhere: isNull(users.deletedAt)` on its conflict update and throws a named `MirrorUserDeleted` error when no row comes back, so no caller (onboarding, invitation acceptance, this webhook) can rewrite a scrubbed row by accident; existing callers keep their signature.
- **AC-9**: A user gone from Clerk who has a local row is scrubbed with `scrubUser()` (email `deleted+<id>@invalid`, name `Deleted user`, `image_url` null, `deleted_at` set), their `memberships` rows are hard deleted, and every `client_contacts` row carrying their `user_id` has `user_id` and `accepted_at` set to null so the contact returns to not invited, in that order: scrub (which locks the user row), memberships, contacts. `deliverables.uploaded_by_user_id` still resolves to the scrubbed row. No local row answers `200` ignored; an already scrubbed row answers `200` handled with no change. The explicit membership delete is required here too: the scrub is an `UPDATE` and the cascade never fires.
- **AC-10**: A membership present in Clerk is upserted on `(org_id, user_id)` with `role` from `toMembershipRole()` (`org:admin` becomes `admin`, anything else becomes `member`) and `updated_at`. The handler always runs three calls in this order inside the transaction, each taking the executor: `upsertOrganizationRow()`, `ensureUserRow()`, `upsertMembershipRow()`, with the local ids taken from the first two calls' `returning`. When the organization or the user has no local row the first two calls create it from the re reads of both objects; this is the only path on which the webhook creates a `users` row, and it uses onboarding's own statements, not `createAgencyRows()` or `ensureMirrorRows()`. When the organization is soft deleted locally the event answers `200` with outcome `refused` and reason `org_deleted`; when the user's local row is scrubbed it answers `200` `refused` with reason `user_deleted`; in both cases nothing is written.
- **AC-11**: A membership gone from Clerk hard deletes the local `(org_id, user_id)` row, resolved through the same two upserts as AC-10 so a late delete for rows that never existed is a no change. No such row answers `200` handled with no change. `deleteMembershipRows()` returns nothing.
- **AC-12**: The write is the lock. The upsert or update of the organization row (organization events) or the user row (user events) locks that row for the rest of the transaction, and for membership events the organization and user upserts run first so the membership write follows behind the organization row's lock. No separate `for update` statement is issued, which is what lets the path for rows that do not exist yet share the same six steps. Two concurrent deliveries about the same object therefore serialise on that row rather than interleave. A unique violation during apply is answered `200` with outcome `refused` and reason `unique_violation`, never `500`.
- **AC-13**: `200` is answered for `handled`, `duplicate`, `ignored` and `refused`. `500` is answered only for a failure a retry might cure: a database error, a Clerk API timeout or rate limit, or a payload or re read that fails its Zod parse (loud on purpose, because it means Clerk's shapes moved). Every `500` follows a full rollback, so the ledger holds no row for it.
- **AC-14**: Every outcome other than `handled`, plus the organization delete of AC-6 (logged explicitly from its branch), writes exactly one structured JSON log line with `event: "clerk.webhook"`, the outcome, the `svix-id`, the event type, a short reason and the identifiers involved, and never an email address, a name, an image URL or any part of the payload.
- **AC-15**: `CLERK_WEBHOOK_SIGNING_SECRET` is declared in the Zod schema in `src/lib/env.ts` (required, `min(1)`) and documented in `.env.example`. The route exports `dynamic = "force-dynamic"` and `runtime = "nodejs"`, stays public in `src/proxy.ts`, and is the only new file that imports `withSystemAccess`; neither ESLint exemption list changes.
- **AC-16**: The handler in `src/auth/webhook.ts` takes its database handle and a narrowed `ClerkGateway` (three re reads) as arguments, so verification order, replay, reverse order, refusals and rollback are tested against a fake with no network, no Clerk key and no account, and the transactional behaviour is proven against a real PostgreSQL.

## Decision

**Chosen option**: Option 2: Re read from Clerk on every event, on the Stripe webhook's six step shape

One route handler verifies each Clerk delivery, treats the event as a pointer to one object, re reads that object from the Clerk backend API, and upserts or deletes the local mirror inside a transaction that also claims the `svix-id` in the idempotency ledger, reusing provisioning's statements so the two writers of the mirror share one definition of every column.

**Implementation skills**: `clerk-webhooks` (`clerk`, `.agents/skills/clerk-webhooks/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `zod` (`.agents/skills/zod/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `drizzle` (`.agents/skills/drizzle/`) · `vitest` (`.agents/skills/vitest/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (no migration; every column exists from spec 0002):

| Table | Matched on | Written by this feature | Never written here |
|---|---|---|---|
| `organizations` | `clerk_org_id` (unique) | `name`, `updated_at` on upsert; `slug` on insert only (from `freeSlug()`); `deleted_at` set once on delete via `coalesce(deleted_at, now())` | `slug` on update, `next_invoice_number`, `default_currency`; `deleted_at` is never cleared |
| `users` | `clerk_user_id` (unique) | `email` (lowercased), `name`, `image_url`, `updated_at` on update of a known row; the `scrubUser()` fields and `deleted_at` on delete | a brand new row for a stranger; any field of a row with `deleted_at` set |
| `memberships` | `(org_id, user_id)` (unique) | `role`, `updated_at` on upsert; the row is hard deleted on membership, organization and user delete | nothing else; the table has no soft delete |
| `client_contacts` | `user_id` → the scrubbed user | `user_id` and `accepted_at` set to null on user delete | every other column; `invited_by_user_id` keeps pointing at the scrubbed row |
| `processed_webhook_events` | `(source, event_id)` (unique) | one row per acted on delivery: `source = 'clerk'`, `event_id` = `svix-id`, `event_type` | never updated or deleted here |

Relationships are unchanged: `memberships` is N:1 to `organizations` and N:1 to `users` (cascade on both); `client_contacts` is N:1 to `users` through its nullable `user_id`.

**State transitions**:

The organization and user rows have one irreversible transition each: `live → soft deleted`, taken when a re read says the object is gone. Nothing in the product moves a row back, because Clerk never reuses an identifier. A membership row has no state; it exists or it does not.

The handler's own order, mirrored from spec 0007 and applied identically to every event:

1. **Verify** the signature over the raw body. Fail: `400`, nothing read.
2. **Resolve** the object kind and identifiers from the payload with a Zod parse of the identifier fields only: `data.id` for user and organization events, `data.organization.id` and `data.public_user_data.user_id` for membership events.
3. **Re read** from Clerk, outside any transaction: `users.getUser(id)`, `organizations.getOrganization({ organizationId })`, or `organizations.getOrganizationMembershipList({ organizationId, userId: [id], limit: 1 })`. Present or gone is the only thing step 5 needs to know.
4. **Ledger**: open the transaction and insert the `svix-id` with conflict do nothing. Nothing inserted: `200` duplicate.
5. **Lock and apply**: the write is the lock (AC-12). Organization events: `upsertOrganizationRow()` or `softDeleteOrganization()` then `deleteMembershipRows({ orgId })`. User events: `ensureUserRow()` after the known and not scrubbed checks, or `scrubUser()` then `deleteMembershipRows({ userId })` then `unbindContactsOfUser()`. Membership events: `upsertOrganizationRow()`, `ensureUserRow()`, then `upsertMembershipRow()` or the `(org_id, user_id)` delete. Always organization, then user, then membership.
6. **Commit.**

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/webhooks/clerk` | POST | raw body (req), `svix-id`, `svix-timestamp`, `svix-signature` headers (req) | JSON `{ outcome }` with `outcome` one of `handled`, `duplicate`, `ignored`, `refused`, `failed`, `unverified` | Svix signature over the raw body with `CLERK_WEBHOOK_SIGNING_SECRET`; no session | `400` unverified; `500` failed (retry); everything else `200` |

Internal surface, all named exports:

| Module | What it holds |
|---|---|
| `src/app/api/webhooks/clerk/route.ts` | The short route file: `request.text()`, `withSystemAccess("clerk webhook: a signed provider event, no session to scope to", ...)`, `handleClerkWebhook({ db, gateway, request })`, `Response.json({ outcome }, { status })`. |
| `src/auth/webhook.ts` | `handleClerkWebhook()`, the six steps, `CLERK_WEBHOOK_EVENTS` (the eight), the `WebhookRefusal` shape and the outcome type, taking `db` and `gateway` as arguments. |
| `src/auth/webhook-events.ts` | The Zod schemas for the identifier fields of the three payload shapes, and for the three re read results reduced to `MirrorOrganization`, `MirrorUser` and `{ role }`. |
| `src/auth/webhook-log.ts` | `logClerkWebhook()`, one JSON line, shaped like `src/payments/log.ts`. |
| `src/auth/clerk.ts` (existing) | Grows a `ClerkGateway` type with three re reads, each returning `{ present: true, value } \| { present: false }`, and `liveClerkGateway()` built on `clerkClient()`. Reuses the existing `isNotFound()` and the email lowercasing at the boundary. |
| `src/db/tenant/provisioning.ts` (existing) | `upsertMirror()` is split so its organization and membership statements become exported `upsertOrganizationRow()` (returns `{ orgId }`) and `upsertMembershipRow()`; `ensureUserRow()` gains the `setWhere: isNull(users.deletedAt)` guard and the `MirrorUserDeleted` error; adds `softDeleteOrganization()` (returns `{ orgId }` or `not_found`), `deleteMembershipRows({ orgId } \| { userId })` (returns nothing) and `unbindContactsOfUser({ userId })` (returns nothing). All take an executor. Onboarding keeps calling `createAgencyRows()` and `ensureMirrorRows()` unchanged. |
| `src/db/tenant/context.ts` (existing) | `resolveContactContext` gains a second left join to `organizations` on `client_contacts.org_id`, selects its `deleted_at`, and folds `orgDeletedAt === null` into the `owned` filter (AC-7). |
| `src/lib/env.ts` (existing) | `CLERK_WEBHOOK_SIGNING_SECRET`. |

**Value sourcing** (every value each action produces, computes, or displays names where it comes from):
| Action | Value produced / displayed | Source |
|---|---|---|
| Verify | the signing secret | `env().CLERK_WEBHOOK_SIGNING_SECRET`, passed as `signingSecret` (AC-1, AC-15) |
| Verify | the bytes the signature covers | `request.text()`, never a parsed and re serialised body |
| Ledger | `event_id` | the `svix-id` request header, stable across Svix retries; the Clerk payload carries no id of its own |
| Ledger | `event_type` | the verified event's `type` |
| Any event | which object to re read | Zod parsed identifier fields of the payload: `data.id` (user, organization), `data.organization.id` and `data.public_user_data.user_id` (membership) |
| Organization upsert | `name` | the re read `Organization.name` |
| Organization upsert | `slug` on insert | `freeSlug()` in `src/db/tenant/provisioning.ts` (spec 0005); never rewritten |
| Organization delete | `deleted_at` | the database clock, `coalesce(deleted_at, now())` |
| Organization delete log line | the subscription status | `subscriptions.status` for that `org_id`, read inside the transaction after the organization update, or the literal `none` |
| User upsert | `email`, `name`, `image_url` | the re read `User`, converted by the existing `clerkUser()` mapping in `src/auth/clerk.ts`, which lowercases the email |
| User upsert | whether the person is known | a `users` row with that `clerk_user_id` exists and has `deleted_at` null |
| User delete | the scrubbed fields and `deleted_at` | `scrubbedUserFields()` in `src/lib/scrub.ts` (spec 0002) |
| User delete | which contacts to unbind | `client_contacts.user_id = users.id` |
| Membership upsert | `role` | the re read membership's `role` through `toMembershipRole()` in `src/db/tenant/context.ts` |
| Membership upsert | the organization and user rows when missing | re reads of both objects, written by `upsertOrganizationRow()` and `ensureUserRow()` |
| Membership upsert and delete | the local `org_id` and `user_id` | the `returning` of those two upserts, never a separate lookup |
| Membership upsert | whether the organization is deleted | `organizations.deleted_at` on the row the upsert just locked |
| Membership upsert | whether the user is scrubbed | `users.deleted_at` on that row, checked before `ensureUserRow()` runs |
| Contact resolution (AC-7) | whether the agency is live | `organizations.deleted_at is null`, joined through `client_contacts.org_id` |
| Every answer | status and outcome | the handler's result, the same six outcomes as `src/payments/log.ts` |

**Key invariants**:
- No column of the three mirror tables is ever written from a webhook payload; only from a re read or from the local database clock.
- The ledger row and the mirror change share one transaction. A `500` never leaves a ledger row behind.
- `deleted_at` on `organizations` and `users` only ever moves from null to set. Provisioning does not write it, and this feature never clears it.
- The webhook creates a `users` row only alongside a membership. `user.updated` for a stranger is ignored; `user.created` is not even subscribed.
- Every mirror column has exactly one statement that writes it, in `src/db/tenant/provisioning.ts`, and both writers (onboarding and this webhook) call it.
- The role column stays a display mirror. No permission check reads it (spec 0001, spec 0002); the session claim remains authoritative.
- Ordering among the three tables inside one transaction is fixed: organization, then user, then membership, matching `upsertMirror()`, so the two writers cannot deadlock against each other.
- No email address, name, image URL or payload fragment reaches a log line.

**Security model**:
- The route is public in the proxy and trusts nothing but a valid Svix signature. Unverified bodies are never parsed.
- The re read is the trust boundary for content: even a valid signature only says which object to look at, and Clerk's API answers what it holds. A forged or replayed body can therefore at worst cause one extra read of an object the sender already had to name.
- Unscoped database access is confined to the route file through `withSystemAccess`, with the reason recorded and the ESLint fence unchanged (spec 0003).
- Personal data in scope: a name, an email address and an avatar URL, mirrored from Clerk as spec 0005 already does. This feature reduces exposure rather than adding to it: rows for strangers are never created, and a deleted account is scrubbed within Clerk's delivery window. The scrub is what a GDPR erasure request rests on for the mirror; the audit trail of that erasure is the AC-14 log line plus the ledger row. No new regulated category enters the system.
- Rate limiting is not added: every request that reaches the handler carries a valid signature, and Svix's own delivery is the only caller. The signature check is cheap enough to absorb noise on the public path.

**Configuration required**:
- `CLERK_WEBHOOK_SIGNING_SECRET`: the `whsec_...` value of the Clerk dashboard endpoint, used by `verifyWebhook`. Required in `src/lib/env.ts`; set in `.env` locally and in Vercel for production.
- Prerequisite, dashboard only: a webhook endpoint in the Clerk dashboard pointing at `https://<deployment>/api/webhooks/clerk`, subscribed to exactly the eight AC-2 events. Locally, `clerk webhooks listen` (the Clerk CLI relay) or a tunnel to `localhost:3000`, each with its own endpoint and secret, as `.env.example` explains.

**Critical test scenarios** (each maps to an acceptance criterion in ## Requirements):
- Happy path: rename an agency in Clerk, `organization.updated` arrives, the handler re reads and upserts, `/dashboard` shows the new name, one ledger row exists with the `svix-id`, verifies **AC-3**, **AC-4**, **AC-5**.
- Happy path: remove a member in Clerk, `organizationMembership.deleted` arrives, the membership list re read is empty, the local row is gone, verifies **AC-11**.
- Replay: the same delivery (same `svix-id`) sent twice; the second answers `200` duplicate, the mirror row's `updated_at` is unchanged, and the ledger still holds one row (the re read runs before the ledger claim, so the fake gateway does record a second read, and that is expected), verifies **AC-3**.
- Reverse order: two `user.updated` deliveries whose payloads carry the old and new name, delivered new first; the fake gateway answers the current name both times; the mirror holds the current name after both, verifies **AC-4**.
- Membership before organization: `organizationMembership.created` for a person and an agency with no local rows; the fake gateway serves all three objects; one row lands in each table in one transaction, verifies **AC-10**.
- Deleted person with a bound contact: `user.deleted` scrubs the user, removes their memberships, and the contact row shows `user_id` null and `accepted_at` null while the deliverable they uploaded still joins to `Deleted user`, verifies **AC-9**.
- Deleted agency: `organization.deleted` sets `deleted_at`, removes memberships, calls no Stripe method (the fake has none to call), and logs the subscription status; a portal visit by that agency's contact lands on the spec 0014 no contact path, verifies **AC-6**, **AC-7**, **AC-14**.
- Stranger: `user.updated` for an id with no local row answers `200` ignored and the `users` count is unchanged, verifies **AC-8**.
- Failure case: the fake gateway throws a timeout on re read; the answer is `500`, no ledger row exists, and the redelivery is then handled, verifies **AC-13**, **AC-3**.
- Failure case: the database throws inside apply; the transaction rolls back, no ledger row, `500`, verifies **AC-3**, **AC-13**.
- Concurrency: two deliveries for the same organization run at once against real PostgreSQL; both commit, one row, no deadlock, verifies **AC-12**.
- Auth/permission: a body with no `svix-signature`, or a wrong one, answers `400` and the fake gateway records no call at all, verifies **AC-1**.
- Auth/permission: a verified `session.created` event answers `200` ignored with no write, verifies **AC-2**.
- Config: the route file is the only new importer of `withSystemAccess`, and `tools/eslint/tenant-isolation-config.test.mts` still passes untouched, verifies **AC-15**.

## Build plan

Tracer Bullet: one event through every layer first, including the dashboard endpoint and a real delivery, then thicken object by object. No migration anywhere in the plan.

1. **Configuration and the gateway.** Add `CLERK_WEBHOOK_SIGNING_SECRET` to `src/lib/env.ts` and uncomment its `.env.example` entry with the dashboard steps (endpoint URL, the eight events, the relay for local runs). Extend `src/auth/clerk.ts` with the `ClerkGateway` type (three re reads returning present or gone) and `liveClerkGateway()`, reusing `isNotFound()`. Create the dashboard endpoint and put the secret in `.env`, satisfies **AC-15**, **AC-4**.
2. **One thread end to end on `organization.updated`.** Split `upsertMirror()` in `src/db/tenant/provisioning.ts` so `upsertOrganizationRow()` is exported (onboarding behaviour unchanged). Write `src/auth/webhook-events.ts` with the identifier schemas and the organization re read schema, `src/auth/webhook-log.ts`, and `src/auth/webhook.ts` with all six steps but only the organization upsert path applied. Add `src/app/api/webhooks/clerk/route.ts`. Prove it by renaming the agency in Clerk through the relay and reloading `/dashboard`, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-5**, **AC-12**, **AC-13**, **AC-14**, **AC-16**.
3. **Organization delete and the contact fence.** Add `softDeleteOrganization()` and `deleteMembershipRows()` to provisioning, the delete path in the handler with the subscription status log line, and the `deleted_at is null` join in `resolveContactContext`, satisfies **AC-6**, **AC-7**.
4. **Users.** The `setWhere` guard and `MirrorUserDeleted` in `ensureUserRow` (with a provisioning test that a scrubbed row is not rewritten), the known only update, the `user_deleted` refusal, and the delete path in order: `scrubUser()`, `deleteMembershipRows({ userId })`, `unbindContactsOfUser()`, satisfies **AC-8**, **AC-9**.
5. **Memberships.** Export `upsertMembershipRow()`, the upsert path with the org and user re reads when rows are missing, the `org_deleted` refusal, and the delete path, satisfies **AC-10**, **AC-11**.
6. **Proof.** `src/auth/webhook.test.ts` with a fake gateway for verification order, the eight event filter, replay, reverse order, every refusal and the `500` paths; `src/auth/webhook.db.test.ts` on real PostgreSQL (the shape of `src/payments/webhook.db.test.ts`) for the ledger and change committing together, rollback, the cascade of a user and an organization delete, the contact unbind, and two concurrent deliveries; a `context.db.test.ts` case for the deleted agency contact; and a walk through the relay for each of the eight events recorded in `verify.md`, satisfies **AC-3**, **AC-4**, **AC-12**, **AC-13**, **AC-16**.

## Consequences

**Positive**:
- One webhook pattern in the codebase, not two. Anyone who has read `src/payments/webhook.ts` can read `src/auth/webhook.ts`.
- The mirror converges on Clerk's truth even when a delete event is lost, because the next event about that object re reads and finds it gone.
- Two writers of the mirror share one statement per column, which closes the flicker risk spec 0005 flagged.
- The product stores fewer people: no rows for abandoned sign ups, and a deleted account is scrubbed without a support ticket.
- A deleted agency stops serving its portal to clients, which was open before this feature.

**Negative / tradeoffs**:
- One Clerk backend API call per delivery, three for a membership whose rows are missing. Clerk's rate limits are generous next to this product's event volume, but a burst (an admin removing thirty members at once) will queue behind them, and each 429 is a `500` and a Svix retry rather than a fast path.
- A deleted account's uploaded files keep a `Deleted user` attribution forever, by spec 0002's design. Full erasure of that pointer is not offered.
- A deleted agency is only soft deleted. Its clients, projects, invoices and files stay in the database and in R2 until something decides otherwise; feature 18 is the natural place, and until then storage cost accrues for dead agencies.
- The Stripe subscription of a deleted agency keeps billing until the feature 18 reconcile exists or someone cancels it in the Stripe dashboard. The AC-6 log line is the only signal.
- A contact of a deleted agency lands on `/onboarding`, the spec 0014 no contact path, which reads as an agency sign up rather than an explanation. Correct, but blunt.
- Staleness that arrives without an event (a webhook endpoint disabled by Svix after days of failure) is invisible until feature 18's sweep. Names and roles then lag; permissions do not, because they never read the mirror.

**Neutral**:
- Spec 0001's Clerk event list loses `user.created` and gains the contact unbind on `user.deleted`; an amendment note is added to spec 0001.
- `src/db/tenant/provisioning.ts` grows from two exported writers to seven named functions. It is still the one file that writes the three mirror tables.
- `processed_webhook_events` now takes rows from two sources and nothing prunes it. It is small (one short row per event) and indexed on `processed_at`, which is what a prune would use.
- `resolveContactContext` gains a join. The contact path was already two tables and stays request cached (spec 0014).

## Follow-up

- [ ] Feature 18 (daily cron): a nightly Clerk reconcile that lists organizations and their memberships from Clerk, repairs any local row that disagrees, and scrubs users Clerk no longer has. This is the staleness half of the scope's "missed event" rule; retries and the `no_mirror_row` repair are the absence half and ship here.
- [ ] Feature 18: decide what happens to the Stripe subscription, the rows and the R2 objects of a soft deleted agency. This feature only logs the subscription status (AC-6).
- [ ] Feature 18: a retention prune for `processed_webhook_events`, now fed by two sources.
- [ ] Feature 16 (team members and roles) renders member lists from `memberships`; it should read `users.deleted_at` and show nothing for a scrubbed row rather than `Deleted user`.
- [ ] `clerk-webhooks` conventions not yet captured. `src/auth/` has no `AGENTS.md`; one holding the Clerk conventions this feature and spec 0005 rely on (the backend wrapper, the mirror writers, the webhook shape) should exist before implementation begins, with a one line pointer from root `AGENTS.md` (do not add area specific conventions to root `AGENTS.md`; root loads on every task).
- [ ] The CI `browser` job has no database (spec 0014 follow up); the `webhook.db.test.ts` here runs in the unit job against the throwaway PostgreSQL like `src/payments/webhook.db.test.ts`, but the relay walk stays manual.
