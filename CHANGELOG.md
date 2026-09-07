# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The database schema behind the whole product: eleven tables covering organizations, users, memberships, subscriptions, clients, client contacts, projects, deliverables, invoices, invoice line items and a webhook idempotency ledger, with their relations, in `src/db/schema/` (see spec 0002).
- Structural tenant separation. Every tenant scoped table carries an `org_id` column that cannot be null and points at `organizations(id)`, and each of those tables has at least one index whose leading column is `org_id`. This is the column the multi tenant security model rests on.
- One baseline migration in `drizzle/` that creates all eleven tables with their constraints and indexes against an empty database.
- Money rules the database enforces, so wrong arithmetic cannot be stored at all: an invoice total always equals its subtotal plus tax, tax always follows from the stored rate in basis points, a line item's amount always follows from its own quantity and unit price, and no money column may go negative. Money is stored as whole cents, quantities as exact decimals to three places, and every invoice carries its own three letter currency.
- Uniqueness the database guarantees: one invoice number per agency, one contact email per client, one row per provider webhook event, and one deliverable per storage object key.
- Delete rules that protect work history. A client with invoices or projects cannot be deleted, nor a project with deliverables. Deleting an invoice removes its line items, and deleting an organization removes its memberships.
- Insert and select schemas from drizzle-zod for all eleven tables, exported from `src/db/schema`, so input crossing into the server is parsed rather than cast.
- Money helpers in `src/lib/money.ts` for line amounts, tax and invoice totals. They round half away from zero and reject any quantity that is not a plain decimal.
- `newId()` in `src/lib/id.ts`, a uuid v7 generator, so ids sort by creation time and new rows land at the right edge of the index.
- `scrubUser()` in `src/lib/scrub.ts`, which soft deletes a person and overwrites their email, name and avatar in place, while rows that reference them still resolve.
- `pnpm db:schema:assert`, which reads the PostgreSQL catalogue and checks that every expected table, unique constraint, CHECK constraint and foreign key delete action matches spec 0002.
- `pnpm db:seed`, a repeatable development seed (1 agency, 2 staff, 3 clients, 4 contacts, 3 projects, 4 deliverables and 5 invoices covering every status). Running it again updates rather than duplicates.
- A host guard on the seed. It refuses to open a connection unless the `DIRECT_URL` host is `localhost` or the host named in the new `SEED_ALLOW_HOST` variable, so a production connection string in the wrong terminal changes nothing.
- `SEED_ALLOW_HOST`, a new optional server variable, added to `src/lib/env.ts` and `.env.example`.
- A CI job that applies every migration to a throwaway PostgreSQL 17 container from empty, runs it a second time to prove it is repeatable, and then asserts the resulting schema.
- A `Migrate and deploy` workflow that applies migrations to the deployed database on every merge to `main` before the production deploy, so a failing migration stops the release. Vercel's own git deploys for `main` are turned off in `vercel.json` to hand that ordering to the workflow.

### Changed

- `src/db/schema.ts`, which was an empty placeholder, is replaced by the `src/db/schema/` directory. Import from `src/db/schema` as before.

### Fixed

- `pnpm db:migrate:check` now fails when the schema has drifted from the committed migrations. It was passing an absolute path to `drizzle-kit`, which broke the snapshot read while still exiting zero, so the check reported success with uncommitted tables sitting in the schema.
- `insertOrganizationSchema` no longer demands `default_currency` and `next_invoice_number`. Overriding a column that has a database default was making it required, so an insert could not fall back to the defaults the database already provides.
