# Verify: Clerk webhook sync · spec 0015 · updated 2026-09-17

_Steps derived from spec 0015 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Automated (already run and passing against real PostgreSQL)

These are covered by `src/auth/webhook.db.test.ts`, `src/db/tenant/provisioning.db.test.ts` and `src/db/tenant/context.db.test.ts`, all skipped automatically when `DIRECT_URL` is unset. Run with:

```bash
corepack pnpm test
```

- [x] Unsigned or badly signed delivery → `400 unverified`, no gateway call, no write → AC-1
- [x] `session.created` / `user.created` (unsubscribed events) → `200 ignored`, no write → AC-2
- [x] Same `svix-id` delivered twice → second answers `200 duplicate`, ledger still holds one row → AC-3
- [x] Two `user.updated` deliveries in reverse payload order → mirror holds Clerk's *current* name both times → AC-4
- [x] `organization.updated` / `organization.created` → name upserted from the re read, not the payload → AC-5
- [x] `organization.deleted` → `deleted_at` set, memberships removed, subscription status logged, idempotent on replay → AC-6
- [x] Contact of a soft deleted agency → resolves `no_contact`, not `no_mirror_row` → AC-7
- [x] `user.updated` for a stranger → `200 ignored`, no row created; for a scrubbed row → `200 refused user_deleted` → AC-8
- [x] `user.deleted` on a known row → scrub, memberships removed, `client_contacts.user_id`/`accepted_at` nulled → AC-9
- [x] `organizationMembership.created` with no local org/user rows → creates all three in one transaction; refuses `org_deleted` / `user_deleted` when either is locally deleted → AC-10
- [x] `organizationMembership.deleted` → hard deletes exactly that `(org_id, user_id)` row; no-op if it never existed → AC-11
- [x] Two concurrent `organizationMembership.created` deliveries for the same pair → both commit, exactly one row, no deadlock → AC-12
- [x] A write that throws mid transaction → full rollback, no ledger row, `500`, and the redelivery is then processed → AC-13
- [x] `ensureUserRow` never revives or rewrites a scrubbed row, even called directly (defence in depth) → AC-8
- [x] `upsertOrganizationRow` never revives or rewrites a soft deleted row → AC-10

## Manual (needs a live Clerk dashboard and account — not available in this session)

- [ ] Create the webhook endpoint in the Clerk dashboard at `<deployment>/api/webhooks/clerk`, subscribed to exactly the eight events in `CLERK_WEBHOOK_EVENTS` (`src/auth/webhook.ts`) → AC-2, AC-15
- [ ] Set the real `CLERK_WEBHOOK_SIGNING_SECRET` (dashboard or `clerk webhooks listen` relay) in the deploy environment → AC-1, AC-15
- [ ] Rename an agency in Clerk → `organization.updated` arrives → `/dashboard` shows the new name, one ledger row exists → AC-1, AC-3, AC-4, AC-5
- [ ] Remove a member in Clerk → `organizationMembership.deleted` arrives → the local membership row is gone → AC-11
- [ ] Delete a person's Clerk account who has a bound client contact → the contact returns to "not invited" in the portal → AC-9
- [ ] Delete an agency in Clerk → a client contact of that agency visiting the portal lands on the spec 0014 no-contact path → AC-6, AC-7
- [ ] Walk all eight subscribed events through the relay once each and confirm each lands as this checklist predicts; tick this box once done

## Commands

- [x] `corepack pnpm typecheck` → clean
- [x] `corepack pnpm lint` → clean
- [x] `corepack pnpm format:check` → clean
- [x] `corepack pnpm db:migrate:check` → no drift (spec 0015 needs no migration)
- [x] `corepack pnpm test` → 3159/3159 passing, including the new suites above

## Acceptance-criteria coverage

AC-1 (verify) · AC-2 (event filter) · AC-3 (ledger/replay) · AC-4 (re read is truth) · AC-5 (organization upsert) · AC-6 (organization delete) · AC-7 (contact fence) · AC-8 (user upsert, stranger, scrubbed) · AC-9 (user delete, contact unbind) · AC-10 (membership upsert, creates missing rows, refusals) · AC-11 (membership delete) · AC-12 (the write is the lock, concurrency) · AC-13 (500 only on a retryable failure) · AC-14 (structured logging, spot-checked via the AC-6 test's `console.warn` assertion) · AC-15 (env schema, route exemptions — both confirmed by `typecheck`/`lint`/the existing `tenant-isolation-config.test.mts`) · AC-16 (handler takes `db`/`gateway` as arguments — proven by every automated test above using a fake gateway and, for the unit-level cases, no database at all) — all covered above except the manual relay walk, which needs a live Clerk dashboard endpoint this session had no access to.
