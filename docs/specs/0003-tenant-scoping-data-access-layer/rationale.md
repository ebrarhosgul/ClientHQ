# 0003. Tenant scoping data access layer, rationale

The build spec is [index.md](index.md). This file holds the reasoning, the options weighed and the forces behind them. `/develop` does not read it.

## Context

> ⚠️ Premise note: the framing of this feature is right, and it is the correct thing to build now. One thing should be said plainly anyway. Choosing application enforcement means the guarantee is a helper plus a lint rule, and both of those are code that a future change can widen. The database itself will still hand over any row asked for. That is an acceptable trade for a product with one operator and no customer data in it, and it stops being acceptable the moment a second real agency's data is in the same database. The trigger for revisiting row level security is named in Follow-up rather than left as a vague someday, because the cost of adding it grows with every query written against this layer.

Spec 0002 built eleven tables, eight of which carry a not null `org_id` pointing at an organization. Nothing yet reads them. Spec 0001 settled the isolation model in one sentence that this feature has to turn into code: every read and write goes through a single server side layer that applies the organization filter, and a query against a tenant table with no `org_id` predicate is a defect rather than a style issue.

The forces:

- **This scoping fails open.** Postgres will happily return another agency's rows. Nothing in the schema refuses. One forgotten `where` clause in one list query is a cross tenant data leak, and it will look exactly like working code in review.
- **Two audiences, not one.** Agency staff resolve from a Clerk session that carries an organization. End clients are Clerk users who are deliberately not members of the agency organization, so their tenant comes from a `client_contacts` row instead. The schema allows one person to be a contact of several clients, including across agencies, so a contact context has to name a client as well as an organization.
- **The layer is built before its callers.** Feature 4 comes before sign in (feature 6) and before the first real screen (feature 7). It has to be provable on its own, without a UI to click.
- **Not everything has a tenant.** The Stripe and Clerk webhooks and the daily cron write `organizations`, `users`, `memberships` and `subscriptions` with no session at all. If those routes quietly get the raw handle back, the boundary is only as strong as the exemption list.
- **The pooler constrains the shape.** Runtime queries go through the Supabase transaction mode pooler with prepared statements off and a pool of one. Anything that adds a round trip per query is paid on every page render, on a free tier.
- **The tooling half is already in place.** The ESLint rule banning imports of `src/db/client.ts` exists and passes, so the fence is built and waiting for the gate. Its current exemption covers all of `src/db/**`, which is wider than it needs to be.

Not deciding costs more than usual here: every feature from slice 1 onward writes queries, and each one written before this layer exists is a query that has to be rewritten against it later.

## Options considered

### Option 1: Hand written query functions per feature

No generic mechanism. Each feature adds named functions inside the layer (`listClients(ctx)`, `getInvoice(ctx, id)`), each writing its own organization predicate.

**Pros**:
- Every query is explicit, readable and reviewable as plain Drizzle.
- Arbitrary joins, aggregates and window functions are free, since nothing is wrapped.

**Cons**:
- Safety is entirely by review. The hundredth function is exactly as easy to get wrong as the first, and a missing predicate reads as normal code.
- The layer grows with the product, so the security surface never stops expanding.

### Option 2: A scoped accessor derived from the schema, plus two named doors (chosen)

One generic accessor, generic over any table type carrying an `org_id` column, exposing a familiar Drizzle shaped set of methods with the tenant predicate already applied and no way to reach the unfiltered builder. Two deliberately conspicuous exceptions live inside the layer: `unsafeTenantQuery` for shapes the accessor cannot express, and `withSystemAccess` for the webhook and cron routes that have no tenant at all. Writes go through a `withTenantAction()` wrapper that declares its Zod schema, resolves context, and returns a Result.

**Pros**:
- The common case is safe by construction. Forgetting the predicate is not expressible, and passing a table without `org_id` is a compile error.
- New tables are covered automatically, because coverage is derived from the column rather than from a list somebody maintains.
- The exceptions are two greppable names rather than a growing lint exemption list, so a reviewer can see the whole boundary at once.

**Cons**:
- The accessor has to expose a method for every shape features need, and the first shape it cannot express sends someone to the escape hatch.
- Generic types over Drizzle table types are the fiddliest code in the project, and a type error in the accessor is not a pleasant afternoon.
- The escape hatch is a real leak surface. It is fenced to one directory, but it is still a door.

### Option 3: A callback handing over the raw builder with a scope token

`withTenant(ctx, ({ db, scope }) => db.select().from(clients).where(scope(clients)))`. Full Drizzle power inside the callback, with a helper that produces the right predicate.

**Pros**:
- No accessor surface to maintain, and every Drizzle feature is available everywhere with no escape hatch needed.
- Much simpler types than a generic accessor.

**Cons**:
- You can still forget to call `scope()`, which puts the project back to safety by discipline. That is the exact property this feature exists to remove.
- A reviewer has to read every query body to know it is safe, rather than trusting the call shape.

### Option 4: Postgres row level security as the primary mechanism

Turn on row level security on all eight tenant tables, run every query inside a transaction that sets a per request variable, and let the database refuse foreign rows.

**Pros**:
- Fails closed. A forgotten predicate returns nothing instead of everything, which is the only enforcement that survives a careless query.
- Enforcement holds for anything reaching the database, including a future script or a background job that never learned the conventions.

**Cons**:
- Needs a dedicated application role that does not bypass policies. Supabase's default connection role does, so this is a role, grant and migration exercise before a single policy is useful.
- Every read becomes a transaction on the pooler, so `begin`, `set local`, the query and `commit` on every render, paid on the free tier.
- Policies are a second place where isolation logic lives, and the two can disagree silently.

### Option 5: Generate one concretely typed accessor per table

A build step reads the schema and emits a concrete, fully typed accessor per tenant table, each applying the same shared predicate helper, in the same spirit as the `drizzle-zod` schemas spec 0002 already generates.

**Pros**:
- Identical coverage guarantee with almost no generic types, so the fiddliest risk in Option 2 disappears.
- The generated code is readable, and a reviewer can see the predicate in each accessor rather than trusting a type parameter.

**Cons**:
- A generation step in the build, plus generated files in the repository that must be regenerated whenever the schema changes, and a stale one is a silent hole.
- Harder to express the two context kinds and the executor axis without generating four variants per table.

## Rationale

Option 2 is chosen because the load bearing force in Context is that this scoping fails open and the failure looks like working code. Options 1 and 3 both answer that with review discipline, which is exactly what the product cannot rely on across twenty features and many months of building. Making the unsafe query unexpressible is worth the fiddly generic types, and deriving coverage from the `org_id` column rather than a maintained list means the tenth table added in a later slice is protected without anyone remembering to protect it.

Option 4 is the stronger answer and it is deliberately deferred, not rejected. The reasons are timing rather than merit: it needs a separate database role and a policy migration across eight tables, and it charges an extra round trip on every read through the pooler for a guarantee that matters most once real agencies share the database. The choke point in the chosen design exists precisely so that adding it later is a change in one function plus a migration, rather than a rewrite of every call site. Follow-up names the trigger.

The wrapper is hand written rather than delegated to a typed action library for the same reason spec 0001 gave for writing the webhooks and permission checks by hand. This is roughly fifty lines composing three things the project already depends on, sitting directly on the security boundary, and a dependency there buys convenience in exchange for a layer of someone else's opinions between a reviewer and the guarantee.

Two smaller calls are worth recording. Resolution throws rather than returning a Result, against the project's general rule that expected failures are values, because a scoped query reached with no tenant context is a defect and not an expected outcome. Making it a value would force an unwrap on every read in every Server Component to handle a case that means the code is already broken. Writes still return Results, because a validation failure or a missing row genuinely is an expected outcome. And a cross tenant hit returns not found rather than forbidden, because telling a caller that an id exists somewhere else is itself a small leak.

Option 5 is held as a named fallback rather than rejected. If milestone 2's generic types fight back, generating a concrete accessor per table buys the same guarantee for a generation step, and the project already generates `drizzle-zod` schemas the same way. That is a decision better made against a real compile error than in advance, so it lives in Follow-up.

Two corrections came out of the cross check and are worth recording. The portal originally resolved its client from a route segment, which spec 0001 does not have: its portal routes are `/portal`, `/portal/projects/[id]` and `/portal/invoices`, and it already chose a cookie to select the active contact when a user has several. This spec now follows that, with the difference that the cookie is re-verified against the user's own rows on every request and discarded when it does not match, so it selects among rows already owned and never supplies a tenant. And spec 0001 said resolution upserts a missing mirror row from the Clerk API on the spot; this spec makes resolution a pure read and hands the upsert to feature 6, so spec 0001 carries a pointer to that amendment rather than being left to contradict this one.
