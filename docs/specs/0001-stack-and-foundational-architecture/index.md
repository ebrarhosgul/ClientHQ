# 0001. Stack and foundational architecture for the agency client portal

**Date**: 2026-09-05
**Status**: Accepted

## Summary

This settles what the whole product is built on and how tenants stay apart. It is a single Next.js application on Vercel, with Postgres on Supabase reached through Drizzle (a lightweight database toolkit), Clerk for sign in and agency organizations, Stripe for the monthly subscription, Cloudflare R2 for client files, and Sentry for error tracking. Agencies share the same database tables and are separated by an organization id column that one shared data access layer always applies, so no screen or action can reach another agency's rows by accident. Everything runs inside free or student tiers, and the pieces that carry the most risk (Stripe webhooks, permission checks, tenant scoping) are written by hand rather than delegated, because those are the parts worth being able to explain.

## Decision

**Chosen option**: Option 1: Next.js full stack on Vercel with managed services.

One deployable Next.js application using React Server Components for reads and Server Actions for writes, backed by managed Postgres, with identity, payments, storage, email, and observability each handled by a specialist provider. Tenant separation lives in a shared server side data access layer keyed on the Clerk organization id.

**Implementation skills** (installed in `.agents/skills/`, linked from `.claude/skills/`):
`clerk-orgs` · `clerk-webhooks` · `clerk-billing` · `clerk-nextjs-patterns` · `clerk-setup` (`clerk/skills`) · `stripe-best-practices` · `stripe-integration` (`stripe/ai`) · `supabase-postgres-best-practices` · `supabase` (`supabase/agent-skills`) · `drizzle` · `drizzle-migrations` · `nextjs-app-router-patterns` · `shadcn` · `zod` · `upstash-ratelimit-js` (`upstash/skills`) · `resend` · `react-email` (`resend/resend-skills`) · `vercel-functions-runtime` · `vercel-observability` (`vercel-labs/agent-skills`) · `playwright-cli` · `vitest`

73 skills are installed in total, pruned from an initial over broad install. Their conventions are authoritative where they conflict with generic practice.

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript on Node 22 LTS | One language across server and browser, and long term support that outlasts this project. |
| Package manager | pnpm | Fast, disk efficient, and strict about undeclared dependencies, which catches a class of real bugs. |
| Framework | Next.js App Router | Server Components keep data fetching on the server, and Server Actions handle writes without a separate API layer to secure. |
| UI | Tailwind CSS with shadcn/ui | Accessible Radix based components copied into the repo as source you own, with no runtime dependency or version lock. |
| Validation | Zod | One schema gives both the runtime check and the TypeScript type, so they cannot drift apart at the trust boundary. |
| Primary database | PostgreSQL on Supabase (free tier) | Relational data with real constraints, and 1GB storage with a connection pooler that suits serverless. |
| ORM | Drizzle ORM | Around 31KB with no dependencies and sub second cold starts, which matters when every request may start a fresh function. |
| Auth and identity | Clerk (Pro plan) | Organizations, invitations, and roles are the exact shape this product needs, and building them is a known way to ship a security hole. |
| Payments | Stripe Checkout Sessions plus Billing Portal | Card data never touches the app, and card updates, cancellation, and invoice history come free. |
| File storage | Cloudflare R2 | 10GB free with zero egress fees, so client downloads never generate a bill, and it is S3 compatible so there is no lock in. |
| Email | Resend | 3,000 emails a month free with React Email templates, so emails are components like the rest of the app. |
| Background work | One daily Vercel Cron route plus a database idempotency table | A single scheduled route runs every sweep in sequence, staying inside the Hobby limit of two slots, and webhook safety comes from recording event ids rather than a queue vendor. |
| Rate limiting | Upstash Redis | Free tier limiting for invite sends and upload URL signing. Sign in is hosted by Clerk and rate limited there, so it is out of scope. |
| Observability | Sentry (student Team plan) | Errors and traces across server and browser, with session replay only on errors to protect the quota. |
| Hosting | Vercel Hobby | Built by the Next.js team, so App Router, streaming, and image optimization work with no configuration. |
| Testing | Vitest plus Playwright | Unit tests on the money and permission logic, end to end tests on sign up, invite, and checkout. |
| CI | GitHub Actions | Typecheck, lint, unit tests, and a migration check on every push, with Vercel handling preview deploys. |

## Foundational architecture

### Tenant isolation

Every tenant scoped table carries an `org_id` column holding the Clerk organization id. All reads and writes go through a single server side data access layer that applies the filter; no Server Component, Server Action, or route handler builds a query directly against a tenant table.

**The invariant**: a query against a tenant scoped table without an `org_id` predicate is a defect, not a style issue. Enforce it by construction, with a helper that takes the resolved tenant context as a required argument and returns a scoped query builder, so an unscoped query cannot be written without deliberately bypassing the helper.

The tenant context is resolved once per request from the Clerk session (`orgId` for agency staff) or from the signed in user's `ClientContact` row (for end clients), never from a URL segment, a form field, or a header.

### Roles and access

| Role | Where it lives | May do |
|---|---|---|
| `admin` | Clerk organization role, mirrored to `Membership.role` | Billing, invite and remove members, org settings, full CRUD on clients, projects, deliverables, invoices |
| `member` | Clerk organization role, mirrored to `Membership.role` | Full CRUD on clients, projects, deliverables, invoices. No billing, no member management, no org settings |
| `client` | Not a Clerk org role. A signed in Clerk user linked to a `ClientContact` row | Read only. Sees its own client's projects, deliverables flagged visible to the client, and its own invoices |

End clients are Clerk users but never members of the agency's Clerk organization, so they consume no agency seats and never appear in the member list.

Enforcement runs at two levels. Clerk middleware is the coarse gate: it decides whether the request is signed in and routes it to the agency area or the client portal. Every real check on who owns what runs in the data access layer, which is the only place that reads the tenant context and the role.

### Subscription access gate

Access is derived at read time from `Subscription.status` and `past_due_since`. Nothing stores the gate state, so a grace window expires on its own without a scheduled job to expire it.

| Stripe state | App state | Effect |
|---|---|---|
| No `Subscription` row, or `incomplete` | Unsubscribed | Only billing and account pages reachable. The billing page offers Checkout, not the Billing Portal |
| `trialing`, `active` | Full | Everything works |
| `past_due`, within 7 days of `past_due_since` | Grace | Reads work everywhere. All writes are blocked. Persistent banner links to the Billing Portal |
| `past_due`, beyond 7 days | Locked | Only billing and account pages reachable |
| `unpaid`, `canceled`, `incomplete_expired`, `paused` | Locked | Same as above. Stripe moves to `unpaid` only after it has exhausted its retries, so it is a terminal state, not a grace state |

`past_due_since` is set on the first transition into `past_due` and cleared on any return to `active`. Data is never deleted by the gate.

**Where the gate runs.** Clerk middleware runs on the edge and cannot open a TCP connection to the Supabase pooler, so it cannot read subscription state. Middleware therefore decides only whether the request is signed in and which area it belongs to. The gate itself runs in two places, both server side: the agency route group layout reads the subscription through the data access layer and redirects when the state is Locked or Unsubscribed, and a `withTenantAction()` wrapper that every Server Action goes through refuses writes when the state is Grace, Locked, or Unsubscribed.

**Binding checkout to an organization.** A brand new organization has no `Subscription` row and Stripe has no way to know which organization a payment belongs to. The Server Action that creates the Checkout Session sets `client_reference_id` to the `org_id` and also puts `org_id` in `subscription_data.metadata`. The webhook reads it from there to create the row. The Billing Portal is only offered once a `stripe_customer_id` exists.

### Webhook handling

Two verified webhook endpoints, one for Stripe and one for Clerk. Both follow the same shape:

1. Verify the signature against the signing secret, before parsing anything. Reject a failure with 400.
2. Open a database transaction.
3. Insert the provider event id into `ProcessedWebhookEvent`. A unique constraint violation means this event was already handled, so roll back and return 200 without doing anything else.
4. Apply the state change **in that same transaction**, then commit. The ledger insert and the state change must commit together. Committing the ledger first would mark an event processed even when the state change fails, and the provider's retry would then be a silent no operation.
5. Any other error rolls the transaction back and returns 500, so the provider retries.

**Ordering.** The idempotency ledger prevents duplicate processing but does nothing about out of order delivery, and Stripe does not guarantee order. So on any subscription related event, do not trust the event payload's snapshot: call `subscriptions.retrieve` and apply the object Stripe returns. The event becomes a signal that something changed, not the source of what it changed to.

Stripe events consumed: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.

Clerk events consumed: `user.created`, `user.updated`, `user.deleted`, `organization.created`, `organization.updated`, `organization.deleted`, `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`.

Clerk role mapping: `org:admin` becomes `admin`, `org:member` becomes `member`. On `organization.deleted` the local Organization is soft deleted and its Memberships are removed. On `user.deleted` the User row is soft deleted and its Memberships removed.

**Roles are read from the Clerk session claims, not from the local mirror.** `Membership.role` exists so member lists can be rendered with a join, but a role demoted in Clerk stays stale locally until a webhook lands, and an authorization check must never read a stale role. The session claim is authoritative for every permission decision.

Clerk sync has a safety net for missing rows: any request that resolves a tenant context and finds no matching local row upserts it from the Clerk API on the spot, so a webhook missed during a deploy does not strand a user. This covers absence, not staleness, which is why roles come from the session. Amended by [spec 0003](../0003-tenant-scoping-data-access-layer/index.md): the data access layer resolves and never writes, so it raises a typed `no_mirror_row` instead and feature 6 performs the upsert. The safety net still exists, it just lives one layer up.

### Client portal access and invitation

The whole portal depends on linking a `ClientContact` row to a real Clerk user, so the flow is specified here rather than left to the build.

1. Agency staff add a `ClientContact` with a name and an email address.
2. The server sends an invitation through Resend containing a single use token: the contact id and an expiry, signed with `INVITE_TOKEN_SECRET`. Only a hash of the token is stored, alongside `invite_expires_at`, which is 7 days out.
3. The recipient opens `/portal/accept?token=...`, which requires them to sign in or sign up with Clerk first.
4. One Server Action then verifies the token signature and expiry, and **requires that the signed in Clerk user's primary verified email matches `ClientContact.email`**. Without that check, anyone holding a forwarded link could claim the contact. On success it sets `user_id` and `accepted_at` and clears the token hash.

**Resolving which identity is acting.** Do not infer it from the kind of user. Resolve it from the path: a request under `/dashboard` and the rest of the agency area resolves its tenant from the Clerk session's active organization, and a request under `/portal` resolves it from a `ClientContact` row matched on `user_id`. The same person can legitimately be agency staff in one organization and a client contact of another. If one user has several `ClientContact` rows, a cookie selects the active one, defaulting to the most recently accepted.

### Invoice lifecycle

No money moves through this platform, so an invoice is a record the agency keeps and the client reads.

**Numbering.** A unique constraint on (`org_id`, `number`) makes concurrent inserts fail; it does not assign anything. `Organization.next_invoice_number` is incremented with an `UPDATE ... RETURNING` inside the same transaction that assigns the number, which serialises assignment without a separate lock. Numbers are assigned on the transition from `draft` to `sent`, so drafts carry no number and issued invoices form a gapless sequence. The integer is stored, and a display form such as `INV-0001` is derived from it.

**States and transitions**:

| From | To | Trigger |
|---|---|---|
| `draft` | `sent` | Agency staff issue it. Line items freeze, the number is assigned, the client contacts are emailed |
| `draft` | `void` | Agency staff discard it |
| `sent` | `paid` | Agency staff mark it paid. `paid_at` is set by hand, since no payment flows through the app |
| `sent` | `overdue` | The daily cron, where status is `sent` and `due_date` is in the past |
| `sent`, `overdue` | `void` | Agency staff cancel it |
| `overdue` | `paid` | Agency staff mark it paid |

The client portal shows only `sent`, `paid`, and `overdue`. Drafts and voided invoices are never visible to a client.

### Data model sketch

Every table below except `User` and `ProcessedWebhookEvent` carries `org_id` and is indexed on it.

| Entity | Key fields | Relationships and constraints |
|---|---|---|
| `Organization` | `id`, `clerk_org_id` (unique), `name`, `slug`, `next_invoice_number` (integer, default 1), `deleted_at` (nullable), timestamps | The agency. Mirrors a Clerk organization. The counter serialises invoice numbering |
| `User` | `id`, `clerk_user_id` (unique), `email`, `name`, `image_url`, `deleted_at` (nullable) | Mirrors a Clerk user. Not tenant scoped, since one person may belong to several agencies |
| `Membership` | `id`, `org_id`, `user_id`, `role` (`admin` or `member`) | Unique on (`org_id`, `user_id`). A display mirror of Clerk membership. Permission checks read the Clerk session claim, not this column |
| `Subscription` | `id`, `org_id` (unique), `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `status`, `current_period_end`, `cancel_at_period_end`, `past_due_since` (nullable) | One per organization. Written only by the Stripe webhook handler |
| `Client` | `id`, `org_id`, `name`, `company_email`, `notes`, `status` (`active` or `archived`) | The agency's customer company |
| `ClientContact` | `id`, `org_id`, `client_id`, `user_id` (nullable until accepted), `email`, `name`, `invite_token_hash` (nullable), `invite_expires_at` (nullable), `invited_at`, `accepted_at` (nullable) | Unique on (`client_id`, `email`). Indexed on `user_id`, since every portal request looks up by it. The portal login link |
| `Project` | `id`, `org_id`, `client_id`, `name`, `description`, `status`, `due_date` (nullable) | Status is a fixed enum: `planning`, `in_progress`, `in_review`, `delivered`, `archived` |
| `Deliverable` | `id`, `org_id`, `project_id`, `name`, `r2_key` (unique), `content_type`, `size_bytes`, `uploaded_by_user_id`, `visible_to_client` (boolean), `status` (`pending` or `ready`) | The R2 object key is stored, never a public URL. A `pending` row has no confirmed object behind it and is never shown to anyone |
| `Invoice` | `id`, `org_id`, `client_id`, `number` (integer, null while `draft`), `status`, `issue_date`, `due_date`, `currency`, `subtotal_cents`, `tax_cents`, `total_cents`, `paid_at` (nullable) | Unique on (`org_id`, `number`). Status is `draft`, `sent`, `paid`, `overdue`, `void` |
| `InvoiceLineItem` | `id`, `org_id`, `invoice_id`, `description`, `quantity`, `unit_amount_cents`, `amount_cents`, `position` | Cascade deletes with its invoice |
| `ProcessedWebhookEvent` | `id`, `source` (`stripe` or `clerk`), `event_id` (unique), `event_type`, `processed_at` | Not tenant scoped. The idempotency ledger |

All money is stored as integer cents with an explicit currency. Never floating point.

Invoices are internal records the agency manages. No money moves through this platform, so there is no Stripe Connect, no payouts, and no merchant of record obligation. The only money flow is the agency paying its own subscription.

### Routing

| Area | Path shape | Tenant resolved from |
|---|---|---|
| Marketing and sign in | `/`, `/sign-in`, `/sign-up` | Not applicable |
| Agency application | `/dashboard`, `/clients`, `/projects`, `/invoices`, `/settings`, `/billing` | Clerk session active organization |
| Client portal | `/portal`, `/portal/projects/[id]`, `/portal/invoices` | The signed in user's `ClientContact` row, matched on `user_id` |
| Invitation acceptance | `/portal/accept` | The signed token in the query string, plus the signed in Clerk user |
| Webhooks | `/api/webhooks/stripe`, `/api/webhooks/clerk` | Not applicable. Signature verified, no session |
| Cron | `/api/cron/daily` | Not applicable. Guarded by `CRON_SECRET` |

No organization slug or subdomain appears in URLs. The active organization comes from the Clerk session, which means agency links are not portable between organizations, and that is an accepted tradeoff.

### File handling

Uploads and downloads both use short lived presigned URLs so file bytes never pass through Vercel, which sidesteps the serverless request body size limit.

1. The browser asks a Server Action for an upload URL, sending the file name, type, and size.
2. The action checks the role and tenant, validates type and size against an allowlist, generates an `r2_key` namespaced by `org_id` and `project_id`, **inserts the `Deliverable` row with status `pending`**, and returns a presigned PUT URL valid for a few minutes. The URL is signed with a fixed `Content-Type` and `Content-Length` so the browser cannot upload something other than what it declared.
3. The browser uploads directly to R2.
4. The browser confirms completion. The server then calls `HeadObject` on the key, copies the real size and content type from R2 rather than trusting what the browser claimed, and flips the row to `ready`. A `pending` deliverable is never listed, never downloadable, and never visible in the portal.

Downloads work in reverse: the server checks that the requester may see this deliverable and that it is `ready`, then returns a presigned GET URL valid for a few minutes. Object keys are never guessable public URLs, and the bucket has no public read access.

Deleting a deliverable deletes the R2 object first and the row second, so a failure leaves a row pointing at a missing object (recoverable and visible) rather than an object nobody references (invisible and billable). Deleting a project or client cascades the same way.

### Scheduled work

Vercel Hobby allows two cron slots at daily frequency, so everything runs from **one** route, `/api/cron/daily`, guarded by `CRON_SECRET`, executing in sequence:

1. Mark `sent` invoices whose `due_date` has passed as `overdue`.
2. Delete `pending` deliverables older than 24 hours, and their R2 objects, since step 3 of an upload can succeed while step 4 never runs.

The route's own database queries double as the keep alive that stops the Supabase free tier project suspending through inactivity, so that is not a separate job.

The subscription grace window needs no job, because the gate is derived at read time from `past_due_since` rather than stored.

### Client portal scope

The portal shows, for the signed in contact's client only: projects that are not `archived`, deliverables on those projects where `visible_to_client` is true and status is `ready`, and invoices in `sent`, `paid`, or `overdue`. Everything else is invisible, including archived projects, internal deliverables, drafts, and voided invoices.

### Configuration required

- `DATABASE_URL`: Supabase transaction mode pooler, port 6543. Drizzle must run with prepared statements disabled against PgBouncer
- `DIRECT_URL`: direct connection on port 5432, used by migrations only
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`: Clerk client and server keys
- `CLERK_WEBHOOK_SIGNING_SECRET`: verifies inbound Clerk webhooks
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`: Stripe client and server keys
- `STRIPE_WEBHOOK_SECRET`: verifies inbound Stripe webhooks
- `STRIPE_PRICE_ID`: the monthly subscription price
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`: Cloudflare R2 credentials
- `RESEND_API_KEY`, `EMAIL_FROM`: transactional email
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: rate limiting
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`: error tracking and source map upload
- `CRON_SECRET`: shared secret the daily cron route requires
- `INVITE_TOKEN_SECRET`: signs client portal invitation tokens
- `NEXT_PUBLIC_APP_URL`: absolute base URL for Stripe redirects and email links

## Consequences

**Positive**:
- One deployable unit, one language, one repository. Debugging never crosses a service boundary.
- Server Components and Server Actions keep database access and secrets out of the browser bundle, so there is no separate API service to deploy and secure.
- Tenant scoping in one shared layer gives a single place to audit and a single place to test, rather than a check repeated in every action.
- Money and identity are handled by providers whose job that is. The parts written by hand are the parts worth being able to explain in an interview: webhook idempotency, the access gate, tenant scoping.
- Everything fits inside free or student allowances, so the running cost is effectively zero.
- Presigned uploads mean file size is limited by R2, not by the serverless request limit.

**Negative and tradeoffs**:
- Eight external providers. Each is one more dashboard, one more set of credentials, one more status page, and one more thing that can fail independently. This is the real cost of the managed services approach.
- `org_id` scoping enforced in application code fails open. One query that bypasses the helper leaks data across tenants, and nothing in the database stops it. Postgres row level security would fail closed instead, and was not chosen.
- A Server Action is an unauthenticated POST endpoint wearing a function signature. Calling them "server side" does not make them safe. The design only holds if every action goes through the tenant wrapper, which means the raw Drizzle handle must not be exported from its module (export only the scoped builder) and a lint rule must block importing it elsewhere. Without that, the "by construction" claim is really just discipline.
- Permission checks read the Clerk session claim while the local `Membership.role` mirror can be stale. Two representations of the same fact, with only one authoritative, is a thing every future contributor has to be told.
- Vercel Hobby forbids commercial use. The moment this earns money it needs a paid plan, or a different host.
- Supabase free tier projects pause after about a week of inactivity. A portfolio project that sits idle will greet a visitor with a cold or unavailable database unless something keeps it warm.
- Drizzle has a smaller ecosystem than Prisma and no equivalent of Prisma Studio, so inspecting data means SQL or the Supabase dashboard.
- Drizzle over the Supabase transaction pooler cannot use prepared statements. Forgetting that setting produces confusing runtime errors.
- The Sentry student Team plan lasts one year and has on demand spending disabled, so exceeding the quota stops collection rather than billing you.
- Vercel Hobby cron runs at most two jobs, once a day each. Anything needing finer scheduling requires a different approach.
- The active organization living in the Clerk session rather than the URL means agency links are not shareable across organizations.

**Neutral**:
- Clerk and Stripe state is mirrored into Postgres, so there are two sources of truth kept in step by webhooks. This is deliberate and it is the standard pattern, but it is real machinery that needs its own tests.
- Drizzle migrations are checked into the repository and applied through CI, so schema changes are reviewable.
- The client portal and the agency application share one codebase and one database, separated by route group and by the data access layer rather than by deployment.

## Follow-up

- [ ] Design the visual direction and dashboard shell in its own `/architect` pass before any screens are built, so `/develop` is not inventing a look from shadcn defaults.
- [ ] Run `/scope` to turn this stack into a feature roadmap, then link this spec from the scaffold feature row.
- [ ] Run `/audit` after scaffolding to create the root `AGENTS.md`. It needs an `## Agent skills` section listing the 73 installed skills by area, plus a nested `src/payments/AGENTS.md` for the Stripe and webhook conventions and a nested `src/auth/AGENTS.md` for the Clerk and tenancy conventions, so area rules load only when working in that area.
- [ ] Review the installed skills before relying on them. They are third party content that runs with full agent permissions, and 73 of them were installed in bulk rather than individually vetted.
- [ ] Decide whether to add Postgres row level security as a second line of defence once the schema settles. It is the single biggest security upgrade available to this design, and the reason it was deferred is serverless connection pooling, not that it is unwanted.
- [ ] Add the ESLint rule blocking imports of the raw database handle outside the data access layer, during scaffolding. The tenant isolation guarantee depends on it, so it is not optional tidying.
- [ ] Revisit Clerk Billing if the hand rolled sync proves burdensome. It does exist and it does cover organization plans, so the door is open. Two reasons it was not chosen: its billing APIs are marked experimental by Clerk, and plans live in Clerk rather than syncing to Stripe, which would move the source of truth away from Stripe.
- [ ] Consider a read only public demo account once seed data exists, so a reviewer can walk the app without signing up.
- [ ] Add an audit log table if the multi tenancy story becomes a talking point. It was deliberately left out of the first schema.
- [ ] Reconsider whether Upstash earns its place. After correcting the scope, it covers only invite sends and upload URL signing, which a Postgres counter could also do, removing one provider from the eight.

## Rationale

Reasoning, the options weighed, and the landscape evidence: see [rationale.md](rationale.md).
