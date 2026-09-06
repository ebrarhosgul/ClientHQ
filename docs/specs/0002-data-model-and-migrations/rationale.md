# 0002. Data model and migrations: rationale

The reasoning behind [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: this schema stores financial documents (invoices, line items, totals, payment marks) and nothing in it records who changed one or when its state moved. `updated_at` tells you a row changed; it does not tell you what changed, who did it, or what it was before. Spec 0001 deliberately deferred an audit log and the scope keeps it deferred, so this spec proceeds without one, but the honest framing is that it is missing rather than unnecessary. The cheap version is not a general audit log: it is one append only `invoice_events` table (invoice id, from status, to status, actor user id, timestamp) added while the invoice tables are being written, which costs one table now and answers every "why does this invoice say paid" question later. Adding it after invoices exist in production means backfilling history that was never recorded and therefore cannot be recovered. Raised, not blocking; recorded in Follow-up.

[Spec 0001](../0001-stack-and-foundational-architecture/index.md) settled the stack and the tenancy model and sketched eleven entities in a summary table. That sketch was written to prove the architecture hangs together, not to be migrated. It names entities and key fields and stops there: no column types, no nullability, no index shapes, no cascade behaviour, no CHECK constraints, and several fields whose meaning is genuinely ambiguous once you try to write the DDL. `src/db/schema.ts` is still an empty module with a comment pointing at this feature, and `drizzle/meta/_journal.json` has zero entries. Nothing is built.

Three forces shape the decision. The first is that tenant isolation in this product fails open by construction: spec 0001 chose application enforced scoping over row level security, which means one query missing an `org_id` predicate leaks one agency's rows to another and the database does not stop it. Whatever the schema does, it must not make that worse, and it should leave the door open to closing it later. The second is that this is a foundation feature: every one of the seventeen features after it reads or writes these tables, so a column whose type or nullability is wrong gets copied into query code across nine slices before anyone notices. The third is cost of change: nothing is deployed, there is no production data, and the Supabase project is empty, so this is the single cheapest moment in the project's life to get the shape right. That window closes the first time a real row exists.

The consequence of not deciding is that `/develop` invents a schema mid build, one table at a time, from a sketch that does not answer the questions it will hit. The specific gaps: what `org_id` actually references, how quantity is stored given the project forbids floating point money, what enforces that an issued invoice stops changing, what happens to an R2 object when its row is deleted, and how anyone knows the migration will actually apply before it is run against the real database.

## Options considered

### Option 1: One baseline migration, application enforced tenancy, written so row level security can be added later

All eleven tables land in a single generated migration against an empty database. Every tenant scoped table carries `org_id uuid not null` referencing `organizations(id)`, indexed as the leading column of a composite that matches a real query. Invariants that can be expressed in the database (money never negative, totals consistent, `paid_at` agreeing with status, uniqueness, cascade and restrict behaviour) are expressed there; the rest live in the data access layer feature 4 builds. Row level security is not enabled, but nothing in the schema blocks it.

**Pros**:
- One reviewable baseline. A reader sees the whole model in one diff rather than reconstructing it from eleven stacked migrations.
- The relationships are designed together, so the cascade and restrict decisions are coherent instead of made eleven times in isolation.
- `org_id not null` everywhere with no exceptions is exactly the precondition a future row level security policy needs, so the deferred upgrade stays cheap.
- The database catches the invariant violations that application code gets wrong under concurrency, without the operational weight of a policy layer.

**Cons**:
- Tenant isolation still fails open. A CHECK constraint cannot express "this query should have filtered by `org_id`", so the load bearing guarantee remains discipline plus one lint rule.
- A single large migration is harder to reason about than a small one, and if it fails halfway through on the real database you are debugging eleven tables at once rather than one.
- It front loads work into a foundation feature, which is the opposite of what a Tracer Bullet approach usually wants.

### Option 2: The same schema with row level security enabled in this migration

Identical tables, plus `enable row level security` and a policy per tenant table reading a per request setting such as `app.current_org_id`. Tenant isolation fails closed: a query with no `org_id` predicate returns nothing rather than everything.

**Pros**:
- Fixes the single largest security weakness in the whole design, and fixes it before there is any data to leak.
- Removes the dependency on every future contributor remembering the scoping helper.
- Spec 0001 itself names this as the biggest available upgrade.

**Cons**:
- The Supabase transaction mode pooler hands each transaction a different backend connection, so a session level setting does not survive. Every scoped query would need its setting applied inside its own transaction, which changes how the data access layer is built before feature 4 has designed it.
- It moves work out of the deferred scope row and into the foundation, expanding a feature that already covers eleven tables.
- Getting a policy subtly wrong fails closed, which reads as an application bug and is genuinely painful to diagnose from a screen showing zero rows.

### Option 3: No baseline, grow the schema slice by slice

Each feature adds the tables it needs when it needs them. Feature 6 adds organizations, users and memberships; feature 7 adds clients; feature 13 adds invoices.

**Pros**:
- The purest reading of Tracer Bullet: nothing is built before something needs it.
- Each migration is small, obviously correct, and easy to review.
- No speculative columns for features that might change shape before they are built.

**Cons**:
- The relationships get decided piecemeal. By the time invoices arrive, the cascade behaviour on clients was settled six slices ago by someone who was not thinking about financial records.
- The scope row for this feature explicitly names all eleven tables in its Done when clause, so this option does not satisfy it.
- The tenancy invariant is easiest to hold when every table is written to the same template at the same time.

### Option 4: A separate Postgres schema per agency

Each agency gets its own namespace, so tenant separation is structural rather than a column predicate.

**Pros**:
- Isolation is close to airtight. There is no query you can write that crosses tenants by accident.
- Per tenant backup and restore becomes trivial.

**Cons**:
- Every schema change must run against every agency's namespace, so a migration becomes a loop with partial failure modes.
- Connection and search path handling on a transaction mode pooler is significantly harder than a `where` clause.
- Drizzle's migration tooling assumes one schema. This would be hand rolled machinery on a free tier database for a product with no enterprise isolation requirement.

## Rationale

Option 1 was chosen because the two forces that actually constrain this decision, a foundation that seventeen features build on and a moment when change is free, both argue for designing the model whole rather than in fragments. Option 3 loses the coherence exactly where it matters most: the cascade and restrict behaviour on invoices and deliverables is only obviously right when you can see invoices and deliverables at the same time, and deciding it six slices apart is how an agency ends up able to delete a client that has issued invoices. The scope row's Done when clause names all eleven tables, so Option 3 also fails the stated contract.

Option 2 is the technically stronger answer to the isolation problem and it was rejected on operational grounds, not on merit. The blocker is concrete and named in spec 0001: the transaction mode pooler gives each transaction a different backend connection, so the per request setting a policy reads has to be established inside every transaction, which is a decision about how the data access layer works. Feature 4 owns that decision and has not made it. Enabling policies before the layer that must feed them exists is building the lock before the door. What Option 1 does instead is make the upgrade cheap: `org_id uuid not null` on every tenant table with no nullable escape hatch is the whole precondition, and the shape a future policy would take is written down in the index so the deferred scope row is a short piece of work rather than a redesign.

Option 4 was never realistic here. It answers an enterprise data residency requirement this product does not have, and it would replace a `where` clause with a migration loop on a free tier database, which is the sort of operational weight that is not worth carrying for a portfolio project.

Within Option 1, the choices that matter most and why:

**`org_id` is an internal uuid, not the Clerk organization id.** The Clerk id looks free because it is already in the session, but the request has to touch the `organizations` row anyway: spec 0001's safety net upserts a missing local organization on the spot, which is a lookup by `clerk_org_id`. The lookup exists either way, so the string buys nothing and costs a wide key repeated in every row and every index across nine tables, plus a hard coupling of the schema to one provider's id format. This is the one deviation from spec 0001 with a real cost if it is wrong, which is why it was decided first.

**Archiving is a timestamp, not a status value.** Spec 0001 put `archived` inside the project status enum next to `delivered`. Archiving a delivered project would then overwrite the fact that it was delivered, and unarchiving would have to guess where to put it back. These are orthogonal concepts and folding them into one column destroys information that cannot be recovered. `archived_at` also makes "active projects" a null check, which is the cheapest possible predicate.

**Deliverable and invoice foreign keys restrict rather than cascade.** A database cascade is silent and instantaneous, which is exactly wrong for the two things in this schema that have consequences outside the database. Cascading a deliverable row away leaves an object in R2 that nothing references and nobody will find, and you keep paying for it. Cascading an invoice away destroys a financial record. Restrict makes both attempts fail loudly and forces the application to walk the tree in the order spec 0001 already specifies (object first, row second). Projects restrict under clients for the same reason at one remove: a project is work history, and cascading one away because it happened to carry no files yet is a silent loss of exactly the kind this rule exists to prevent. In practice clients are archived rather than deleted, so restrict costs nothing. The cheap trees, line items under an invoice and memberships under an organization, still cascade because there is nothing outside the database to clean up.

**Subscription status has no CHECK constraint while every other status column does.** This looks inconsistent and is deliberate. Every other status column is defined by this codebase, so a constraint catches a typo. Subscription status is defined by Stripe, which has added values before. A constraint there means the day Stripe ships a new status the webhook handler throws, Stripe retries until it gives up, and the subscription silently stops updating while the agency is locked out with no obvious cause. The database should not be the component that refuses to record what actually happened; the exhaustive switch that maps status to access level treats anything unrecognised as locked, which fails safe in the right direction.

**Dates that mean a day are stored as `date`.** An invoice is due on a day, which is how it prints and how a client reads it. Storing a timestamp there invents a time of day, and then "is this overdue" depends on whose midnight you mean. The `date` type removes an entire class of off by one bug from the daily sweep. The related gap, that no timezone is modelled anywhere, is handled by having the application supply `issue_date` rather than the database, so adding `organizations.timezone` later is one column plus a helper rather than a rewrite.

**Quantity is `numeric(12,3)` read as a string.** Agencies bill in hours, so whole numbers are not enough, and the project rule forbids floating point in money arithmetic. Postgres `numeric` is exact decimal, not float, and the `postgres` driver hands it to TypeScript as a string, so nothing rounds behind your back on the way out. The money helper parses that string into an integer count of thousandths before multiplying, which keeps the arithmetic that produces `amount_cents` entirely in integers with exactly one explicit rounding step.

**Freezing an issued invoice is enforced in the data access layer, not by a trigger.** A trigger would fail closed and is the stronger guarantee, and it was not chosen for consistency reasons: every other rule in this project, including the far more dangerous tenant scoping, is application enforced, and a trigger would mean a hand written migration file alongside the generated ones, which cuts directly against the `src/db/AGENTS.md` rule that generated SQL is never edited by hand. Accepting one weaker guarantee to avoid a second, contradictory enforcement mechanism is the right trade at this size, and the trigger stays available as a later upgrade if invoices ever change under someone.

**The migration is proven against a real database in CI.** The existing `db:migrate:check` compares `schema.ts` against the committed snapshots and never opens a connection, which catches drift and cannot catch SQL that generates cleanly and fails to execute. Since the scope's Done when clause is "migrations apply cleanly to a fresh database", the check has to be a real database. A throwaway Postgres service container costs about twenty seconds per run, needs no credentials and no Supabase project, and closes exactly the gap the current check leaves open.
