# 0002. Data model and migrations for the agency client portal

**Date**: 2026-09-06
**Status**: In Progress

## Summary

This settles the real database schema behind the whole product: eleven tables, their column types, their constraints, their indexes and what happens when a row is deleted. Every table that belongs to one agency carries an `org_id` column pointing at that agency, which is the column the entire multi tenant security model rests on. Money is stored as whole numbers of cents and quantities as exact decimals, so nothing ever rounds by accident. All eleven tables land in one migration against an empty database, proven by a job that actually applies it to a real throwaway PostgreSQL before anything reaches Supabase.

## Requirements

**User stories**:

- As an engineer building any later slice, I want a schema whose types, constraints and cascades are already settled, so I am not inventing a column shape halfway through a feature.
- As an agency, I want my rows structurally separated from every other agency's, so no screen or action can reach data that is not mine.
- As an agency, I want the arithmetic on an invoice to be right every time, so the total a client sees always equals the lines above it.
- As the person operating this, I want a migration that is proven to apply before it touches the real database, so a broken release is caught in CI rather than in production.

**Acceptance criteria** (the contract):

- **AC-1**: `pnpm db:migrate` against an empty PostgreSQL database applies every committed migration with no error and creates all eleven tables with their constraints and indexes. Running it a second time applies nothing and exits zero.
- **AC-2**: Every table except `users` and `processed_webhook_events` has an `org_id uuid not null` column referencing `organizations(id)`, and each of those tables carries at least one index whose leading column is `org_id`.
- **AC-3**: Every money column is an integer count of cents, `invoice_line_items.quantity` is `numeric(12,3)`, and every invoice carries a `char(3)` currency filled from `organizations.default_currency` when its draft is created.
- **AC-4**: Two invoices issued concurrently in the same organization, both transactions at READ COMMITTED, receive different consecutive numbers and both commit. A direct insert duplicating (`org_id`, `number`) is rejected by the database.
- **AC-5**: The database rejects any write that makes a money column negative, sets `tax_rate_bp` outside 0 to 10000, makes `total_cents` differ from `subtotal_cents + tax_cents`, makes a line item's `amount_cents` differ from `round(quantity * unit_amount_cents)`, makes `tax_cents` differ from `round(subtotal_cents * tax_rate_bp / 10000.0)`, stores a currency that is not three uppercase letters, stores an email that is not already lowercase, or leaves `paid_at` set on an invoice that is not `paid` or absent on one that is.
- **AC-6**: Deleting a client that has invoices or projects, or a project that has deliverables, is refused by the database. Deleting an invoice removes its line items. Deleting an organization removes its memberships. Every foreign key's `ON DELETE` action matches this spec, asserted by reading the catalogue rather than by eye.
- **AC-7**: On a clean checkout `pnpm db:migrate:check` passes, and it fails when `src/db/schema/` is changed without regenerating.
- **AC-8**: A CI job applies every migration from empty to a throwaway PostgreSQL service container and asserts that each expected table, unique constraint and CHECK constraint exists, and that every foreign key's `ON DELETE` action matches this spec, read from `pg_constraint.confdeltype`.
- **AC-9**: `pnpm db:seed` creates the dataset named in the Build plan (1 agency, 2 staff, 3 clients, 4 contacts, 3 projects, 4 deliverables and 5 invoices covering every status), produces no duplicate rows when run repeatedly, and exits with an error having written nothing when `DIRECT_URL` names a host that is neither `localhost` nor the host in `SEED_ALLOW_HOST`.
- **AC-10**: `src/db/schema` exports a drizzle-zod insert schema and select schema for every table, and `pnpm typecheck` and `pnpm lint` pass with no `any` and no unchecked cast anywhere in the schema, the money helpers or the seed.
- **AC-11**: `client_contacts` accepts the same email under two different clients, rejects a second row with the same email under one client whatever case it was typed in, and accepts the same `user_id` on more than one row.
- **AC-12**: `scrubUser()` soft deletes a user and overwrites `email` with `deleted+<id>@invalid`, `name` with `Deleted user` and `image_url` with null, without violating any constraint, and `deliverables.uploaded_by_user_id` still resolves to that row afterwards.
- **AC-13**: Migrations reach the deployed database through a CI job that runs on merge to `main` before the deploy, and a failing migration stops the release.

## Decision

**Chosen option**: Option 1: One baseline migration, application enforced tenancy, written so row level security can be added later.

All eleven tables land in a single generated migration against an empty database, every tenant scoped table carries `org_id uuid not null` referencing `organizations(id)` as the leading column of a real composite index, every invariant expressible in PostgreSQL is expressed there, and row level security is left off but structurally unblocked.

**Implementation skills**: `drizzle` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/drizzle/`) · `drizzle-migrations` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/drizzle-migrations/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.agents/skills/supabase-postgres-best-practices/`) · `supabase` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/supabase/`) · `postgresql-table-design` (`wshobson/agents`, `.agents/skills/postgresql-table-design/`) · `sql-optimization-patterns` (`wshobson/agents`, `.agents/skills/sql-optimization-patterns/`) · `database-migration` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/database-migration/`) · `db-seed` (`jezweb/claude-skills`, `.agents/skills/db-seed/`) · `zod` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/zod/`) · `github-actions` (`bobmatnyc/claude-mpm-skills`, `.agents/skills/github-actions/`)

## Feature design

### Shared conventions

Every table follows these unless the table spec below says otherwise.

| Convention | Shape |
|---|---|
| Primary key | `id uuid primary key`, filled by `newId()` in `src/lib/id.ts`, a uuid v7 (time ordered, so inserts land at the right edge of the index instead of scattering) |
| Timestamps | `created_at timestamptz not null default now()` and `updated_at timestamptz not null default now()`, with Drizzle's `$onUpdate` refreshing `updated_at` on every write |
| Tenant column | `org_id uuid not null references organizations(id)` on every tenant scoped table, never nullable, no exceptions |
| Fixed value columns | Drizzle `text({ enum: [...] })` for the exact TypeScript union with no cast, plus a `check()` constraint in the same table definition. The one exception is `subscriptions.status` |
| Money | Integer cents in `integer` columns, never `numeric`, never a floating point type |
| Days | PostgreSQL `date` for anything that means a calendar day rather than an instant |
| Naming | `snake_case` columns, plural table names (`user` is a reserved word in PostgreSQL, so plural avoids quoting one table as a special case), `camelCase` in TypeScript |

### Data model

**`organizations`** (the tenant root, not itself tenant scoped)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `clerk_org_id` | `text not null` | unique. The Clerk organization this mirrors |
| `name` | `text not null` | |
| `slug` | `text not null` | unique |
| `next_invoice_number` | `integer not null default 1` | the counter that serialises invoice numbering |
| `default_currency` | `char(3) not null default 'USD'` | copied onto each new invoice draft |
| `deleted_at` | `timestamptz` | nullable. Set by the Clerk `organization.deleted` webhook |
| `created_at`, `updated_at` | `timestamptz not null` | |

**`users`** (**not** tenant scoped: one person may serve several agencies)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `clerk_user_id` | `text not null` | unique |
| `email` | `text not null` | indexed, deliberately **not** unique so a stale mirror row cannot make a webhook write fail. CHECK `email = lower(email)`; the Zod schema lowercases at the boundary |
| `name` | `text` | nullable |
| `image_url` | `text` | nullable |
| `deleted_at` | `timestamptz` | nullable. Soft delete plus in place scrub of `email`, `name` and `image_url` |
| `created_at`, `updated_at` | `timestamptz not null` | |

**`memberships`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE CASCADE** |
| `user_id` | `uuid not null` | → `users(id)` **ON DELETE CASCADE** |
| `role` | `text not null` | `'admin'` or `'member'`, CHECK constrained. A display mirror only; permission checks read the Clerk session claim |
| `created_at`, `updated_at` | `timestamptz not null` | |

Unique (`org_id`, `user_id`). Index (`user_id`).

**`subscriptions`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE CASCADE**, **unique** (one per agency) |
| `stripe_customer_id` | `text not null` | unique |
| `stripe_subscription_id` | `text` | nullable and unique. Checkout creates a customer before a subscription exists |
| `stripe_price_id` | `text` | nullable |
| `status` | `text not null` | Stripe's value verbatim, **no CHECK constraint** (see Key invariants) |
| `current_period_end` | `timestamptz` | nullable |
| `cancel_at_period_end` | `boolean not null default false` | |
| `past_due_since` | `timestamptz` | nullable. Set on the first move into `past_due`, cleared on any return to `active` |
| `created_at`, `updated_at` | `timestamptz not null` | |

**`clients`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE CASCADE** |
| `name` | `text not null` | |
| `company_email` | `text` | nullable |
| `notes` | `text` | nullable |
| `archived_at` | `timestamptz` | nullable. Replaces spec 0001's `status` column |
| `created_at`, `updated_at` | `timestamptz not null` | |

Index (`org_id`, `archived_at`), index (`org_id`, `name`).

**`client_contacts`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE CASCADE** |
| `client_id` | `uuid not null` | → `clients(id)` **ON DELETE CASCADE** |
| `user_id` | `uuid` | nullable until the invitation is accepted. → `users(id)` **ON DELETE SET NULL** |
| `email` | `text not null` | CHECK `email = lower(email)`, and the Zod schema lowercases at the boundary, so `Ada@x.com` and `ada@x.com` are one contact rather than two |
| `name` | `text not null` | |
| `invite_token_hash` | `text` | nullable. Only the hash is stored, never the token |
| `invite_expires_at` | `timestamptz` | nullable |
| `invited_at` | `timestamptz` | nullable |
| `accepted_at` | `timestamptz` | nullable |
| `created_at`, `updated_at` | `timestamptz not null` | |

Unique (`client_id`, `email`). Index (`user_id`), non unique so one person may be a contact of several clients. Index (`org_id`, `client_id`).

**`projects`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE CASCADE** |
| `client_id` | `uuid not null` | → `clients(id)` **ON DELETE RESTRICT**. A project is work history, so losing one silently because it happened to carry no files is not acceptable. Clients are archived, never deleted |
| `name` | `text not null` | |
| `description` | `text` | nullable |
| `status` | `text not null default 'planning'` | `'planning'`, `'in_progress'`, `'in_review'`, `'delivered'`, CHECK constrained. `archived` is **not** a status here |
| `due_date` | `date` | nullable |
| `archived_at` | `timestamptz` | nullable |
| `created_at`, `updated_at` | `timestamptz not null` | |

Index (`org_id`, `client_id`), (`org_id`, `status`), (`org_id`, `archived_at`).

**`deliverables`** (every foreign key **RESTRICT**, because a silent cascade would orphan an R2 object nobody can find and you keep paying for)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE RESTRICT** |
| `project_id` | `uuid not null` | → `projects(id)` **ON DELETE RESTRICT** |
| `name` | `text not null` | |
| `r2_key` | `text not null` | unique. The object key, never a public URL |
| `content_type` | `text not null` | read back from R2 on confirm, not trusted from the browser |
| `size_bytes` | `bigint not null` | same |
| `uploaded_by_user_id` | `uuid not null` | → `users(id)` **ON DELETE RESTRICT** |
| `visible_to_client` | `boolean not null default false` | |
| `status` | `text not null default 'pending'` | `'pending'` or `'ready'`, CHECK constrained. A `pending` row is never listed, downloadable or visible in the portal |
| `created_at`, `updated_at` | `timestamptz not null` | |

Index (`org_id`, `project_id`), index (`org_id`, `status`, `created_at`) for the abandoned upload sweep.

**`invoices`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE RESTRICT** |
| `client_id` | `uuid not null` | → `clients(id)` **ON DELETE RESTRICT**, so a client with financial records cannot be erased |
| `number` | `integer` | nullable while `draft`, assigned on issue |
| `status` | `text not null default 'draft'` | `'draft'`, `'sent'`, `'paid'`, `'overdue'`, `'void'`, CHECK constrained |
| `issue_date` | `date` | nullable until issued. Supplied by the application, not `current_date` |
| `due_date` | `date` | nullable while draft, required on issue |
| `currency` | `char(3) not null` | copied from `organizations.default_currency` at draft creation and frozen. CHECK `currency = upper(currency)` and matching `^[A-Z]{3}$` |
| `subtotal_cents` | `integer not null default 0` | |
| `tax_rate_bp` | `integer not null default 0` | basis points, so 2000 means 20 percent |
| `tax_cents` | `integer not null default 0` | |
| `total_cents` | `integer not null default 0` | |
| `paid_at` | `timestamptz` | nullable |
| `created_at`, `updated_at` | `timestamptz not null` | |

Unique (`org_id`, `number`). Index (`org_id`, `client_id`), index (`org_id`, `status`, `due_date`) for the overdue sweep.

**`invoice_line_items`**

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `org_id` | `uuid not null` | → `organizations(id)` **ON DELETE RESTRICT** |
| `invoice_id` | `uuid not null` | → `invoices(id)` **ON DELETE CASCADE** |
| `description` | `text not null` | |
| `quantity` | `numeric(12,3) not null` | Drizzle `numeric({ precision: 12, scale: 3, mode: 'string' })`. The mode is not optional: without it the driver hands back a JavaScript number and the float this design exists to avoid is back |
| `unit_amount_cents` | `integer not null` | |
| `amount_cents` | `integer not null` | |
| `position` | `integer not null` | display order, 1 based and contiguous, renumbered on reorder |
| `created_at`, `updated_at` | `timestamptz not null` | |

Unique (`invoice_id`, `position`). Index (`org_id`, `invoice_id`).

**`processed_webhook_events`** (**not** tenant scoped: the idempotency ledger)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | primary key |
| `source` | `text not null` | `'stripe'` or `'clerk'`, CHECK constrained |
| `event_id` | `text not null` | the provider's event id |
| `event_type` | `text not null` | |
| `processed_at` | `timestamptz not null default now()` | serves as `created_at`; this is the only table without the usual timestamp pair |

Unique (`source`, `event_id`). Index (`processed_at`) for the 90 day prune. No payload column: the events carry personal data and both providers keep the originals in their own dashboards.

### State transitions

**Invoice** (the schema permits any value; the transitions are enforced by feature 13):

| From | To | Trigger |
|---|---|---|
| `draft` | `sent` | Staff issue it. `number` and `issue_date` are assigned, line items freeze, contacts are emailed |
| `draft` | `void` | Staff discard it |
| `sent` | `paid` | Staff mark it paid. `paid_at` is set by hand; no money moves through this platform |
| `sent` | `overdue` | The daily sweep, where `status = 'sent'` and `due_date` is in the past |
| `sent`, `overdue` | `void` | Staff cancel it |
| `overdue` | `paid` | Staff mark it paid |

**Project**: `planning` → `in_progress` → `in_review` → `delivered`. Archiving is orthogonal and sets `archived_at`. Valid transitions are owned by feature 11; this schema constrains the value set only.

**Deliverable**: `pending` → `ready` on confirmed upload. There is no path back.

**Subscription**: mirrors Stripe. The four access levels (unsubscribed, full, grace, locked) are derived at read time from `status` and `past_due_since`, never stored.

### API surface

This feature ships no HTTP surface. Its interface is the schema module and the commands around it.

| Surface | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `src/db/schema` | Module | none | Drizzle table objects, `relations()`, drizzle-zod insert and select schemas for all eleven tables | none | compile time only |
| `src/lib/id.ts` `newId()` | Function | none | a uuid v7 string | none | none |
| `src/lib/money.ts` | Module | quantity string, cents integers, `tax_rate_bp` | `amount_cents`, `subtotal_cents`, `tax_cents`, `total_cents` | none | throws on a quantity string not matching `^\d{1,9}(\.\d{1,3})?$` |
| `src/lib/scrub.ts` `scrubUser()` | Function | a user id | the soft deleted and scrubbed row | none | none |
| `pnpm db:generate` | Command | `src/db/schema/` | a migration in `drizzle/` plus its snapshot | none | none |
| `pnpm db:migrate` | Command | `DIRECT_URL` | applied migrations | direct connection credentials | SQL failure aborts, applies nothing further |
| `pnpm db:migrate:check` | Command | `src/db/schema/`, `drizzle/` | pass or fail | none | fails on drift, or a journal entry with no file |
| `pnpm db:seed` | Command | `DIRECT_URL`, `SEED_ALLOW_HOST` | seeded rows | direct connection credentials | exits non zero and writes nothing when the host is not allowed |

### Value sourcing

Every value the acceptance criteria need, and where it comes from.

| Action | Value produced or displayed | Source |
|---|---|---|
| Any insert | `id` | `newId()` in `src/lib/id.ts` (uuid v7), never the database |
| Any tenant scoped insert | `org_id` | the resolved tenant context (feature 4), looked up from `organizations.clerk_org_id` matched to the Clerk session `orgId`. Never a URL, form field or header |
| Create an invoice draft | `currency` | copied from `organizations.default_currency` at insert, then frozen |
| Add a line item | `amount_cents` | derived: quantity string parsed to integer thousandths, multiplied by `unit_amount_cents`, divided by 1000, rounded half away from zero. `src/lib/money.ts`. The parser accepts `^\d{1,9}(\.\d{1,3})?$` after trimming and rejects everything else, including scientific notation and negatives |
| Add a line item | `position` | 1 based and contiguous within the invoice, renumbered on reorder. Unique (`invoice_id`, `position`) |
| Recalculate an invoice | `subtotal_cents` | derived: sum of `invoice_line_items.amount_cents` for that invoice |
| Recalculate an invoice | `tax_cents` | derived: `subtotal_cents` times `tax_rate_bp` divided by 10000, rounded half away from zero, and re checked by a CHECK constraint |
| Recalculate an invoice | `total_cents` | derived: `subtotal_cents + tax_cents`, guarded by a CHECK constraint |
| Issue an invoice | `number` | `update organizations set next_invoice_number = next_invoice_number + 1 where id = $1 returning next_invoice_number`, inside the issuing transaction. The row lock serialises concurrent issues for one agency |
| Issue an invoice | `issue_date` | supplied by the application as a calendar day, **not** SQL `current_date`. No timezone is modelled yet, so this is effectively UTC today; see Follow-up |
| Overdue sweep | which invoices move to `overdue` | `status = 'sent' and due_date < <today>`, with today supplied by the application on the same basis as `issue_date` |
| Confirm an upload | `size_bytes`, `content_type` | R2 `HeadObject` on the key, never the browser's claim (spec 0001) |
| Handle a webhook | ledger `source` | the route that received it (`/api/webhooks/stripe` or `/api/webhooks/clerk`), never the payload |
| Prune the ledger | cutoff, and who runs it | `processed_at < now() - interval '90 days'`, run by the daily cron route that feature 18 builds. This spec supplies the index and the cutoff only; nothing here executes it |
| Scrub a deleted user | `email`, `name`, `image_url` | `scrubUser()` in `src/lib/scrub.ts`: `email` becomes `deleted+<id>@invalid` (the `.invalid` domain is reserved by RFC 2606, so it can never route anywhere), `name` becomes `Deleted user`, `image_url` becomes null. `deleted_at` is what tells a scrubbed row apart from one whose fields were simply never set. `email` is not unique, so collisions are impossible |
| Seed | every `id` | hardcoded uuid constants in the seed module, which is what makes re running it an update rather than a duplicate |

### Key invariants

Enforced by the **database**:

- `total_cents = subtotal_cents + tax_cents` on every invoice.
- `amount_cents = round(quantity * unit_amount_cents)` on every line item, so a line's money always follows from its own quantity and unit price.
- `tax_cents = round(subtotal_cents * tax_rate_bp / 10000.0)` on every invoice, so the tax is always reproducible from the stored rate.
- `subtotal_cents`, `tax_cents`, `total_cents`, `unit_amount_cents` and `amount_cents` are all at least zero; `tax_rate_bp` is between 0 and 10000; `quantity` is greater than zero.
- `paid_at` is set exactly when `status = 'paid'`.
- `currency = upper(currency)` and matches `^[A-Z]{3}$`. The format is constrained, not the ISO 4217 code list, which would go stale inside a migration.
- `email = lower(email)` on both `users` and `client_contacts`, so a difference in case can never split one person into two rows.
- (`org_id`, `number`) is unique, so two invoices in one agency can never share a number.
- (`client_id`, `email`) is unique on contacts; (`source`, `event_id`) is unique on the ledger; `r2_key` is globally unique.
- A client with invoices or projects, or a project with deliverables, cannot be deleted.
- `org_id` is never null on a tenant scoped table.

**The rounding rule is shared with the application.** PostgreSQL `round()` on `numeric` rounds half away from zero, so `src/lib/money.ts` must round the same way. If the two ever disagree, a correct looking write is rejected by the CHECK constraint rather than silently stored wrong. That is the safe direction, and it will still look like a mystery constraint violation, so the money tests assert the two agree at the rounding boundaries.

Enforced by the **application** (feature 4's data access layer):

- Every query against a tenant scoped table carries an `org_id` predicate. This fails open: nothing in the database stops an unscoped query.
- `subtotal_cents` equals the sum of its line items' `amount_cents`. This is the one part of the invoice arithmetic no CHECK constraint can express, because it sums across rows.
- The issuing transaction runs at READ COMMITTED, PostgreSQL's default. The `UPDATE ... RETURNING` row lock serialises concurrent issuers there. At SERIALIZABLE one of two concurrent issuers would abort with a serialization failure instead of committing, which breaks AC-4, so nothing on the issuing path may raise the isolation level.
- An issued invoice's line items do not change. Any write to `invoice_line_items` first reads the parent invoice status and refuses anything that is not `draft`.
- `number` is null exactly when `status = 'draft'`. **Deliberately not a CHECK constraint** (your call during design), so a bug could in principle produce a sent invoice with no number. The issuing transaction is the only thing preventing it.
- `subscriptions.status` holds whatever Stripe returned. There is **no CHECK constraint** on purpose: a constraint would make a newly invented Stripe status a hard write failure, so the webhook would throw, Stripe would retry until it gave up, and the subscription would silently stop updating. The mapping to an access level is an exhaustive switch that treats anything unrecognised as locked, which fails in the safe direction.

### Security model

- **Tenancy.** Every tenant scoped table carries `org_id uuid not null` referencing `organizations(id)`. Agency staff resolve it from the Clerk session's active organization; a client contact resolves it from their `client_contacts` row matched on `user_id`. Never from a URL segment, a form field or a header. Enforcement is entirely in the application layer that feature 4 builds; this schema supplies the column, the foreign key and the index, and nothing else.
- **Row level security is not enabled.** The schema is written so it can be: `org_id` is `not null` on every tenant table with no exceptions, which is the only precondition a policy needs. A future policy would take the shape `using (org_id = current_setting('app.current_org_id')::uuid)` with the setting applied inside each transaction, since the transaction mode pooler gives every transaction a different backend connection. That connection work belongs to feature 4, which is why this is deferred rather than done here.
- **Roles.** `memberships.role` is a display mirror for rendering member lists with a join. It can be stale until a Clerk webhook lands, so no permission decision reads it. The Clerk session claim is authoritative.
- **Secrets.** No secret is stored in any table. `client_contacts.invite_token_hash` holds a hash, never the token itself, alongside `invite_expires_at`.
- **Personal data.** The schema holds names and email addresses for agency staff and client contacts, which brings it inside GDPR scope. Erasure is supported without a schema change: soft delete the user and overwrite `email`, `name` and `image_url` in place. `users.email` is deliberately not unique so placeholder values cannot collide. There is **no audit log**, which is a known gap for a schema holding financial records; see Follow-up.
- **Card data** never reaches this database. Stripe holds it. Only customer, subscription and price identifiers are mirrored.

### Configuration required

- `SEED_ALLOW_HOST`: optional, development only. A database host besides `localhost` that `pnpm db:seed` is permitted to write to. Add it to the Zod schema in `src/lib/env.ts` as optional and read it through `env()`, per the project rule that no variable is read from `process.env` directly.
- `DIRECT_URL` as a **GitHub Actions repository secret**. The variable already exists locally; this is a new place it must be set, for the migrate on merge job.

No new runtime environment variables. No third party account to create.

### Critical test scenarios

- **Happy path**: every migration applies from empty to a real PostgreSQL container and every expected table, unique constraint and CHECK constraint is present afterwards, verifies **AC-1**, **AC-8**.
- **Failure case, concurrency**: two transactions issue an invoice for the same organization at the same time; both commit, they receive consecutive different numbers, and a third insert reusing one of those numbers is rejected by the unique constraint, verifies **AC-4**.
- **Failure case, arithmetic**: a write setting `total_cents` to something other than `subtotal_cents + tax_cents` is rejected, as is a line item whose `amount_cents` does not equal `round(quantity * unit_amount_cents)`, a `tax_cents` that does not follow from `tax_rate_bp`, a negative `amount_cents` and a `tax_rate_bp` of 10001. The same boundary values run through `src/lib/money.ts` to prove the TypeScript rounding and the database rounding agree, verifies **AC-3**, **AC-5**.
- **Failure case, deletion**: deleting a client that has an invoice or a project is refused; deleting an invoice removes its line items; deleting a project that has a deliverable is refused; and every foreign key's `ON DELETE` action is read from `pg_constraint.confdeltype` and compared against this spec, verifies **AC-6**.
- **Failure case, guard**: `pnpm db:seed` pointed at a non local host exits with an error and the database is byte for byte unchanged, verifies **AC-9**.
- **Auth and permission**: not applicable at this layer. This schema supplies the `org_id` column and its index; the query that must use it is feature 4's, and a cross tenant access test belongs there. Recorded so the gap is deliberate rather than forgotten.
- **Tenancy shape**: every table except `users` and `processed_webhook_events` has a not null `org_id` and an index leading with it, asserted by reading the catalogue rather than by eye, verifies **AC-2**.
- **Contacts**: the same email under two clients is accepted, a duplicate under one client is rejected including when it differs only in case, and one `user_id` on two rows is accepted, verifies **AC-11**.

## Build plan

Ordered by the project's **Tracer Bullet** approach. The thin thread here is not a user facing slice, it is one table proven all the way through generate, apply, check and CI before the other ten are written, so a broken pipe is discovered while a single table is the only thing to read.

1. [x] Add `src/lib/id.ts` (`newId()`, uuid v7) and `src/db/schema/` with shared column helpers (`id()`, `timestamps()`, `orgId()`). Point `drizzle.config.ts` `schema` at `./src/db/schema`, satisfies **AC-1**, **AC-2**
2. [x] Write `identity.ts` with `organizations` alone. Run `pnpm db:generate`, apply it to a local PostgreSQL, confirm `pnpm db:migrate:check` passes. This is the thread: one table, all the way through, satisfies **AC-1**, **AC-7**
3. [x] Add the CI job that starts a PostgreSQL service container, applies every migration from empty and asserts the expected objects exist, including every foreign key's `ON DELETE` action read from `pg_constraint.confdeltype`. That last assertion matters because the RESTRICT and CASCADE choices are the exact mechanism AC-6 rests on, and a wrong one would otherwise pass CI in silence. Match the container's major version to what the Supabase project actually runs (`select version()`), defaulting to `postgres:17`, satisfies **AC-6**, **AC-8**
4. [x] Add the migrate on merge CI job: `pnpm db:migrate` against `DIRECT_URL` from the repository secret, on merge to `main`, gating the deploy, satisfies **AC-13**
5. [x] Thicken identity: `users`, `memberships`, `subscriptions` with their unique constraints, cascades, indexes and the `email = lower(email)` CHECK. Add `src/lib/scrub.ts` with `scrubUser()`. From here on use `pnpm exec drizzle-kit push` against the local database rather than generating a migration per table, and run it **without** `--force`, so it prompts before any destructive statement rather than quietly dropping and recreating a column on a type change. The single baseline is generated once at step 10, so `db:migrate:check` is expected to fail on this branch until then, satisfies **AC-2**, **AC-6**, **AC-12**
6. [x] Add `clients.ts`: `clients` and `client_contacts`, with `archived_at`, the (`client_id`, `email`) unique constraint, the `email = lower(email)` CHECK so case cannot split one contact into two, the non unique `user_id` index and `on delete set null`, satisfies **AC-2**, **AC-11**
7. [x] Add `projects.ts`: `projects` and `deliverables`, with `archived_at`, RESTRICT on `projects.client_id` and on every deliverable foreign key, the unique `r2_key` and the (`org_id`, `status`, `created_at`) sweep index, satisfies **AC-2**, **AC-6**
8. [x] Add `invoices.ts`: `invoices` and `invoice_line_items`, with the money columns, `currency` and its format CHECK, `tax_rate_bp`, `quantity` as `numeric({ precision: 12, scale: 3, mode: 'string' })`, `position` 1 based and unique per invoice, the (`org_id`, `number`) unique constraint, the (`org_id`, `status`, `due_date`) sweep index, and every CHECK including `amount_cents = round(quantity * unit_amount_cents)` and `tax_cents = round(subtotal_cents * tax_rate_bp / 10000.0)`, satisfies **AC-3**, **AC-4**, **AC-5**
9. [x] Add `webhooks.ts`: `processed_webhook_events` with the (`source`, `event_id`) unique constraint and the `processed_at` index. Declare `relations()` for every table and re export everything from `index.ts`, satisfies **AC-1**
10. [x] Delete the interim migration and its snapshot, run `pnpm db:generate` once to produce the single baseline, apply it to a fresh database and confirm the container job passes on it. This squash is safe **only** because nothing is deployed yet, satisfies **AC-1**, **AC-7**, **AC-8**
11. Add `src/lib/money.ts`: parse a `numeric` string to integer thousandths, accepting `^\d{1,9}(\.\d{1,3})?$` after trimming and rejecting everything else including scientific notation and negatives. Then `lineAmountCents`, `taxCents` and `invoiceTotals`, all in integer arithmetic rounding half away from zero so they agree exactly with PostgreSQL `round()` and the CHECK constraints from step 8. Test the rounding boundaries against the real database, not only in isolation, satisfies **AC-3**, **AC-5**
12. Install `drizzle-zod` (0.8.3 or later, which is where Zod 4 support landed) and export `createInsertSchema` and `createSelectSchema` for every table from `src/db/schema/index.ts`, satisfies **AC-10**
13. Add `scripts/db-seed.ts` and the `db:seed` package script: hardcoded uuid constants, upsert on conflict, and a guard that refuses any `DIRECT_URL` host other than `localhost` or `SEED_ALLOW_HOST`. The dataset is 1 agency, 2 staff (one admin, one member), 3 clients (one archived), 4 contacts (2 accepted, 1 invited and still pending, 1 never invited), 3 projects spread across statuses, 4 deliverables (2 ready and visible to the client, 1 ready and internal, 1 pending) and 5 invoices, one in each of draft, sent, paid, overdue and void, each with line items. Add `SEED_ALLOW_HOST` to the Zod schema in `src/lib/env.ts`, satisfies **AC-9**

## Consequences

**Positive**:

- The whole model arrives as one reviewable baseline, so a reader sees every relationship at once instead of reconstructing it from stacked migrations.
- `org_id uuid not null` on every tenant table with no exceptions means row level security stays a short piece of work rather than a redesign.
- The database guarantees almost all of the invoice arithmetic: a line's amount follows from its own quantity and unit price, tax follows from the stored rate, and the total follows from both. Those checks hold under concurrency and under any code path, including a hand written query in the Supabase dashboard. The single part it cannot guarantee is `subtotal_cents`, because summing across rows is not something a CHECK constraint can express.
- RESTRICT on deliverable and invoice foreign keys makes an orphaned R2 object and a silently destroyed financial record impossible by accident. The delete fails loudly instead.
- `date` columns remove timezone arithmetic from the overdue sweep entirely, which is a whole category of off by one bug that never happens.
- The container job proves the migration against a real PostgreSQL before it touches Supabase, closing the gap the existing drift check structurally cannot cover.
- `archived_at` keeps a project's workflow status intact through archiving, so information that cannot be recovered is not thrown away.

**Negative and tradeoffs**:

- **Tenant isolation still fails open.** No CHECK constraint can express "this query should have filtered by `org_id`". The load bearing guarantee remains discipline plus one lint rule until row level security lands.
- **No audit trail on money.** Nothing records who moved an invoice from `sent` to `paid`, or what a line item said before it was edited. `updated_at` says a row changed and nothing more. This is a real gap in a schema holding financial documents; see Follow-up.
- **The draft and number pairing is not enforced by the database**, so a bug in the issuing transaction could in principle produce a `sent` invoice with a null number, and only the application would have stopped it.
- **One large migration is harder to debug** than a small one. If it fails partway through against the real database you are reading eleven tables of DDL, not one.
- **The push then generate workflow leaves `db:migrate:check` failing mid branch**, from step 5 until step 10. That is expected and it is exactly what the check is for, but it means a red CI signal that has to be understood rather than fixed.
- **The rounding rule is duplicated** between `src/lib/money.ts` and the CHECK constraints, and the two must agree exactly (half away from zero). A disagreement shows up as a correct looking write being rejected, which fails in the safe direction and is still a confusing thing to diagnose.
- **The issuing transaction depends on running at READ COMMITTED.** Raising it to SERIALIZABLE anywhere on that path would abort one of two concurrent issuers rather than serialising them, breaking AC-4. Nothing in the schema enforces this; it is a constraint this spec places on feature 13.
- **`drizzle-kit push` can choose a destructive path** for a type or constraint change. Running it without `--force` makes it prompt, which is the mitigation, and it remains a step where an inattentive yes drops a column.
- **The step 10 squash is safe only while nothing is deployed.** The same move after a release would destroy the applied migration history. This is a one time move, not a technique to reuse.
- **`subscriptions.status` accepts anything**, so a typo in the webhook handler is stored silently rather than rejected. Deliberate, and it is still a weaker guarantee than every other status column has.
- **No timezone is modelled anywhere.** `issue_date` and the overdue sweep both use whatever calendar day the application decides, which is effectively UTC. An invoice issued at 23:00 in Los Angeles gets tomorrow's date.
- **`numeric` read as a string means every consumer must go through the money helper.** A single `Number(quantity)` anywhere reintroduces the float this design exists to avoid, and nothing in the type system stops it.
- **Thirteen tasks in a foundation feature** front loads work that a stricter reading of Tracer Bullet would spread across the slices that need it.

**Neutral**:

- Table names are plural (`users`, `invoices`) where spec 0001 wrote the entities singular, so the sketch and the schema read slightly differently. This avoids quoting `"user"` as a one table special case.
- `drizzle-zod` is a new dependency, small and from the Drizzle team, and it needs 0.8.3 or later for Zod 4.
- Two new CI jobs and one new script, each with its own maintenance surface.
- Deviations from spec 0001's sketch, recorded so the difference is visible: `org_id` is an internal uuid rather than the Clerk id · `archived_at` replaces the archived status on Client and Project · `Organization.default_currency` and `Invoice.tax_rate_bp` are new · `issue_date` and `due_date` are `date` · the ledger is unique on (`source`, `event_id`) · Subscription status carries no CHECK while the others do · Deliverable and Invoice foreign keys RESTRICT · `stripe_subscription_id` and `stripe_price_id` are nullable · `users.email` is indexed rather than unique · tables are plural.

## Follow-up

- [ ] **Add an `invoice_events` table while the invoice tables are being written.** Append only: invoice id, from status, to status, actor user id, timestamp. This schema records financial documents with no history of who changed them, and history not recorded now cannot be recovered later. One table, and it answers every "why does this invoice say paid" question. Raised during design and deliberately left out of the confirmed model; recorded so the gap is a decision rather than an oversight.
- [ ] **Add `organizations.timezone`** so `issue_date` and the overdue sweep use the agency's calendar day rather than UTC. The schema is already shaped for this: the application supplies both dates, so this is one column plus a helper.
- [ ] **Finish connecting the official Supabase MCP server.** `.mcp.json` at the repository root now declares it (remote HTTP, `https://mcp.supabase.com/mcp`, OAuth at first use). It gives an agent live read access to the real schema, so "did this migration actually produce what the spec said" becomes a question you can answer by looking rather than by trusting. Two things remain: authorize it once in the browser, and decide whether to pin it to read only mode and to a single project reference, which is worth doing given it reaches a database holding real tenant data. Flag it for the `MCP servers:` line in `src/db/AGENTS.md`.
- [ ] **Design the row level security policies** in the deferred scope row, once feature 4 has settled how a per request setting is applied inside each transaction on the pooler. This schema supplies the precondition; the connection work is the whole remaining problem.
- [ ] **Consider a trigger that refuses writes to line items of a non draft invoice**, as a fail closed upgrade over the application enforced rule chosen here. It would need a hand written migration file, which cuts against the `src/db/AGENTS.md` rule that generated SQL is never edited, so it is a conscious exception rather than a tidy up.
- [ ] **Consider a CHECK constraint pairing `number is null` with `status = 'draft'`**, which was offered during design and not taken. Without it the gapless sequence is a convention rather than a structural guarantee.
- [ ] **Update `src/db/AGENTS.md`** for the schema folder, the new commands, the plural naming and the RESTRICT convention. `/sync` owns that file, so this is a note for it rather than a build task.
- [ ] **Match the CI container's PostgreSQL major version to the Supabase project's.** Run `select version()` on the real project and pin the container to it, rather than assuming 17.
- [ ] `drizzle-zod` is not covered by any installed Agent Skill and none exists. The `drizzle` skill covers the ORM but not the Zod integration, so its conventions come from the Drizzle documentation directly.

## Rationale

Reasoning, the options weighed, and the premise note: see [rationale.md](rationale.md).
