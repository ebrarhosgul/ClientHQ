# 0001. Rationale and options

Decision record for [index.md](index.md). Read this to understand why. It is not needed to build.

## Context

> ⚠️ Premise note: the original brief describes a whole product, not one decision. It spans at least five independently designable pieces: the stack and tenancy foundation, the billing pipeline, the deliverables portal, internal invoicing, and the visual design. This spec covers only the first, because everything else rests on it. Separate specs are recommended for the billing pipeline, the deliverables portal, and the design system, and `## Follow-up` in `index.md` records them.
>
> A second note on framing. The brief was written in past tense, as a record of something already built, but the project directory is empty. It is a plan. That matters, because a plan can still be changed cheaply and a shipped system cannot, so the tradeoffs below are worth reading now rather than discovering later.
>
> A third note, on scope discipline. The stated goal is a portfolio piece built to production standards, which is a genuinely useful bar. The failure mode it invites is building operational machinery nobody will run: multi region deployment, elaborate queuing, premature caching. The decisions below deliberately stop at the point where more infrastructure would add explanation cost without adding anything a reviewer can see working.

The product is a business to business application for freelancers and small agencies. An agency signs up, pays a monthly subscription, invites a small team, records its own clients, tracks projects for those clients, shares files with them, and issues invoices to them. The agency's own customers get a separate, restricted portal where they see the status of their projects, the files shared with them, and their invoices.

Three forces shape every choice here.

**Isolation is load bearing from day one.** Two different agencies must never see each other's data, and an agency's end client must see far less than the agency's own staff. This is not a feature to add later. Adding a tenant key after launch means rewriting every query, every index, and every permission check, and the window in which a mistake leaks real customer data is exactly the window before anyone notices. The isolation mechanism has to be decided before the first migration runs.

**Money gates access, so subscription state has to be correct and available.** The application must know, on every request, whether this agency is paid up. That state lives at Stripe, but consulting Stripe on every request is slow and breaks when Stripe does. So it must be mirrored locally, and mirroring means webhooks, and webhooks mean duplicate deliveries, out of order events, and events missed during a deploy. Getting this wrong either locks out a paying customer or gives away the product free.

**The budget is real and asymmetric.** There is a Clerk Pro plan, Stripe with waived fees on the first thousand dollars of revenue, and a Sentry student Team plan good for one year. Everything else must fit a free tier. This rules out choices that are correct in general but cost money here, and it makes free tier limits (storage ceilings, egress fees, idle suspension, cron frequency) into architectural constraints rather than footnotes.

Two further constraints come from the situation rather than the product. The team is one person, so anything requiring an operations function is out. And the work is meant to be explained to a reviewer, which means the parts that demonstrate judgment are worth building by hand while the parts that merely demonstrate the ability to read documentation are worth delegating to a provider.

## Options considered

### Option 1: Next.js full stack on Vercel with managed services

One Next.js application holding both the interface and the server logic, deployed to Vercel, with Postgres, identity, payments, storage, email, and error tracking each supplied by a managed provider. Reads happen in React Server Components, writes in Server Actions, and there is no separately deployed backend.

**Pros**:
- One repository, one language, one deployment. Nothing to coordinate across a service boundary.
- Server Actions are server only by construction, so database access and secrets cannot leak into the browser bundle by accident.
- Vercel is built by the Next.js team, so the framework's newer capabilities work without configuration or adapter risk.
- The chosen providers each have a free tier that comfortably covers demo scale, and Clerk plus Sentry are already paid for.
- Fastest path from nothing to a working, demonstrable product for one person.

**Cons**:
- Serverless execution brings cold starts, no persistent database connections without a pooler, and hard limits on request duration and body size. These are real constraints that shape the file upload design.
- Eight providers means eight dashboards, eight credential sets, and eight independent failure modes.
- Vercel Hobby forbids commercial use, so the hosting decision has to be revisited the moment the product earns money.
- Meaningful lock in to Vercel's platform behaviour, even though Next.js itself is portable in principle.

### Option 2: Next.js interface with a separate Node API service

The interface stays on Vercel, but a dedicated backend (NestJS or Fastify) runs as a long lived process on a container host, owning the database, the webhooks, and the background work.

**Pros**:
- A conventional layered backend with controllers, services, and repositories, which is the shape most teams recognise and the easiest to hand to another engineer.
- Long lived processes mean ordinary database connection pooling, no cold starts, and real background workers with no scheduling ceiling.
- The API could later serve a mobile client or a public integration without restructuring.
- Webhook processing runs in a process that can retry and back off on its own terms.

**Cons**:
- Two deployables, two sets of environment variables, two things to keep in step. Every feature touches both.
- Authentication now has to be forwarded from the interface to the API and verified again, which is more surface and more that can be got wrong.
- Roughly doubles the setup work before the first feature exists, for a product with exactly one client application.
- Container hosting free tiers are meaningfully worse than Vercel's, so the budget constraint bites harder.

### Option 3: A batteries included server framework such as Rails or Laravel

A traditional server rendered monolith with the framework supplying the ORM, migrations, background jobs, mailers, and admin tooling out of the box.

**Pros**:
- The most complete answer to this exact problem shape. Multi tenancy, background jobs, and mailers are all solved patterns with mature libraries.
- One process, one deployment, no serverless constraints at all. Background work and file handling are simply easy.
- Decades of accumulated convention mean fewer decisions to make and fewer ways to build it wrong.
- Genuinely faster to a complete product for someone already fluent in the framework.

**Cons**:
- A second language to maintain alongside the TypeScript interface, or a full server rendered interface that gives up the React component model.
- Abandons the specific things the brief sets out to demonstrate: React Server Components, Server Actions, and the modern TypeScript stack.
- Clerk and the wider ecosystem here are TypeScript first, so integration is less direct.
- Hosting a long lived process on a free tier is harder than deploying to Vercel.

### Option 4: Supabase as the platform, with no Clerk and no R2

Lean on one provider for database, authentication, file storage, and row level security, using Postgres policies as the isolation mechanism and dropping Clerk and Cloudflare entirely.

**Pros**:
- Isolation enforced by the database itself, so a forgotten filter returns nothing instead of leaking. This fails closed, which is the correct direction.
- One provider, one dashboard, one bill, far less integration glue.
- Storage, authentication, and data share a permission model, so a file's access rules can be expressed in the same policies as its row.
- Row level security is a strong and defensible thing to be able to explain.

**Cons**:
- Supabase organizations and role management are considerably less developed than Clerk's, and business to business organization handling is the single hardest identity requirement here. Building invitations, roles, and organization switching by hand is exactly the work Clerk exists to remove.
- Walks away from an already paid Clerk Pro plan.
- Row level security with serverless connection pooling requires setting a session variable on every connection, which is fiddly and easy to get subtly wrong in a way that silently disables the protection.
- Supabase storage free egress is far tighter than R2's zero egress, and this product's whole point is clients downloading files.

## Rationale

Option 1 wins because it matches every force in Context at once, and no other option does.

The isolation requirement is met by a shared data access layer rather than by the database, and this is the one decision in this spec that deserves discomfort. Option 4's row level security is genuinely safer: it fails closed, and application enforcement fails open. It was not chosen because the organization management requirement dominates. Business to business identity, with agencies inviting members under roles, is the hardest identity problem in this product, Clerk solves it directly, it is already paid for, and rebuilding it on Supabase authentication would consume the time budget that the rest of the product needs. Choosing Clerk for identity effectively chooses application level enforcement, because the tenant key comes from the Clerk session rather than from a database role. The mitigation is structural, not procedural: the scoping helper takes tenant context as a required argument, so an unscoped query is something you have to go out of your way to write. Row level security is recorded as the first upgrade to make once the schema settles.

The subscription gate is mirrored locally rather than queried live because access checks run on every request and cannot depend on a third party being reachable. Mirroring introduces the duplicate and out of order delivery problem, which the idempotency ledger solves at the cheapest possible price: a unique constraint on the provider's event id, which turns a replayed event into a no operation without any queue infrastructure. This is the standard answer for money related webhooks and it needs no vendor. Inngest would add durable retries and better visibility, and it is the right answer at higher volume, but at this scale it adds a concept and a dependency to explain in exchange for a guarantee the idempotency ledger already provides.

The budget constraint decided several layers outright. Cloudflare R2's zero egress is not a marginal preference for a product whose central feature is clients downloading files; metered egress on a free tier is a bill waiting to happen. Vercel Hobby's limit of two daily cron jobs is what makes the database backed idempotency ledger necessary rather than optional, since scheduled reconciliation cannot run often enough to be the primary safety mechanism.

On the engineer's preferences. The stack in the brief was accepted rather than re litigated, at the engineer's explicit request, and it is a defensible stack. Two picks were made against my recommendation and both are reasonable. Supabase was chosen over Neon: it gives more storage and consolidates providers, at the cost of Neon's database branching and its more serverless native pooling, and it introduces idle project suspension, which matters for a portfolio piece that sits unvisited between reviews. That suspension is the one consequence worth acting on before sharing a link. Drizzle was chosen over Prisma, which is the right call here: cold start cost is a real serverless tax, and queries that read like SQL demonstrate more than queries that hide it.

One claim from the research pass turned out to be wrong, and correcting it strengthens rather than changes the decision. The scan reported that Clerk has no billing product. It does. Clerk Billing supports organization plans, seat limited plans for business to business use, feature entitlements, and its own billing webhooks, and it would remove most of the synchronisation code described here. This was verified from Clerk's own published skill, which is now installed in this project.

Hand rolling the Stripe integration is therefore a choice made against a real available alternative, not an assumption made in ignorance, and that is worth stating plainly. Three reasons it still wins. The engineer's explicit goal is to demonstrate webhook engineering, and delegating it removes exactly the work the project exists to show. Clerk marks its billing APIs as experimental and advises pinning package versions, which is a poor foundation for the one subsystem that must never be wrong. And Clerk Billing keeps plans in Clerk rather than syncing them to Stripe, which moves the source of truth for subscription state away from the payment processor and into the identity provider, a coupling worth avoiding when identity and billing may later need to change independently. If the hand rolled sync becomes a maintenance burden, Clerk Billing is the fallback, and `## Follow-up` records it as such.

## Stack landscape scan

Run 2026-09-05 against the undecided layers only. Full output cached at `docs/.agent-cache/research/stack-landscape.md`. Summary of what it returned, with the caveat that the pricing figures are as reported and worth confirming before relying on them:

- **ORM**: Drizzle at version 1.0, roughly 31KB, no dependencies, no code generation step, cold starts under half a second. Prisma version 7 improved on serverless but remains around 90KB with a generate step and one to three second cold starts. Several prominent TypeScript starter stacks moved their default to Drizzle during 2025.
- **Postgres free tiers**: Neon offers 500MB storage, 100 compute hours a month, pooling included, and scale to zero. Supabase offers 1GB storage and 2GB bandwidth with PgBouncer pooling in transaction mode.
- **Background work**: Inngest reports roughly 50,000 executions a month free with durable step functions. Trigger.dev is comparable. QStash is a lighter pay per message HTTP queue.
- **File storage**: Cloudflare R2 gives 10GB free with no egress charge, S3 compatible. Vercel Blob gives 1GB storage and 10GB transfer. Supabase Storage gives 1GB with 2GB bandwidth.
- **Email**: Resend gives 3,000 a month free, capped at 100 a day. AWS SES gives 3,000 a month for the first year only. SendGrid retired its free tier in 2025.
- **Clerk and Stripe**: the scan reported that Clerk has no billing product. **This was wrong.** Clerk Billing exists and covers organization plans, seat limits, feature entitlements, and billing webhooks, confirmed from Clerk's own published skill (`clerk-billing`, now installed at `.agents/skills/clerk-billing/`). See `## Rationale` for why the hand rolled Stripe sync was still chosen. Treat the rest of this scan's claims with matching caution.

## Cross check

An independent model reviewed this spec on 2026-09-05 and found four outright defects plus several undecided inputs. All were corrected in `index.md` rather than left for the build:

- The webhook idempotency insert committed before the state change, so a failure after the ledger write would mark an event permanently processed and turn the provider's retry into a silent no operation. The insert now shares the transaction with the state change.
- `unpaid` was mapped to the grace window. Stripe moves to `unpaid` only after exhausting its retries, so it is terminal and now maps to Locked. `incomplete` and `paused` were unmapped and now are.
- Three daily jobs were implied against Vercel Hobby's two cron slots. They are now one sequential route, which also serves as the Supabase keep alive.
- Rate limiting listed portal sign in attempts, which Clerk hosts and this application cannot see.

Undecided inputs that were closed: the state of an organization with no subscription row yet, how a Checkout Session binds to an organization, the client contact invitation and account linking flow, invoice number assignment under concurrency, the invoice state machine, the pending state for uploads, the missing Clerk deletion events, role staleness in the local mirror, and whether the portal shows archived projects.

Two of its arguments were considered and declined. It argued that blocking writes at the first failed payment retry punishes customers whose card merely expired, and that row level security is cheaper than stated because setting the tenant id inside a transaction is the standard pattern against a transaction mode pooler. Both were put to the engineer, who kept the original decisions: grace stays read only, and row level security stays a recorded follow up.

## References

**Project sources**:
- No `AGENTS.md` or existing specs. This was the first decision in an empty repository, so nothing in the project constrained it.
- `.agents/skills/clerk-billing/SKILL.md`, Clerk's own published skill, which established that Clerk Billing exists, that its APIs are experimental, and that plans live in Clerk rather than syncing to Stripe.
- 73 installed vendor and community skills covering Clerk, Stripe, Supabase, Drizzle, Next.js, Vercel, shadcn, Upstash, and Resend. Their conventions are authoritative for implementation.
- The engineer's stated provider commitments: Clerk Pro, Stripe with fees waived on the first thousand dollars, Sentry student Team plan for one year.

**Practices and standards**:
- Idempotency keys for money related operations, implemented here as a unique constraint on the provider event id.
- Tenant key on every tenant scoped row, decided before the first migration, rather than retrofitted.
- Signature verification before parsing on every inbound webhook.
- Presigned URLs for direct object storage transfer, keeping file bytes out of the application server.
- Monolith first: extract services only when a measured bottleneck or a team ownership boundary forces it.
- Integer minor units for currency, never floating point.

**Links** (returned by the 2026-09-05 landscape check):
- Neon pricing: https://neon.com/pricing
- Inngest pricing: https://inngest.com/pricing
- Resend pricing: https://resend.com/pricing
- Drizzle and Prisma comparison: https://makerkit.dev/blog/tutorials/drizzle-vs-prisma (secondary source, a vendor blog rather than official documentation)
- Background jobs cost comparison: https://www.buildmvpfast.com/api-costs/background-jobs (secondary source)
- Cloudflare R2 free tier walkthrough: https://dev.to/yeagoo/cloudflare-r2-hands-on-guide-set-up-free-10gb-storage-zero-egress-object-storage-and-325n (secondary source, community post)

Supabase and Vercel free tier limits were reported by the same check but no official pricing page was confirmed, so they are cited by name without a link and should be checked against the vendor's own pricing page before you rely on the numbers.
