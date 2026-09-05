# Next.js B2B SaaS Stack Landscape Research (2026)

**Research Date:** September 5, 2026  
**Scope:** Greenfield Next.js App Router SaaS with Vercel serverless, free-tier only (except Clerk Pro, Stripe, Sentry)

---

## 1. TypeScript ORM: Prisma vs Drizzle ORM

### Current State (2026)
- **Prisma**: v7+ with improved serverless support; bundle size still ~90KB+ gzipped; requires `prisma generate` step on schema changes; mature ecosystem with Prisma Studio, Accelerate (connection pooling), Pulse (realtime), vast community integrations
- **Drizzle ORM**: v1.0 stable; 31KB gzipped; zero dependencies; no code generation required; instant type updates; serverless-ready by design; cold starts <500ms vs Prisma's 1-3s (though Prisma v7 improved by up to 9x)

### Major 2025-2026 Shifts
- **T3 Stack, Epic Web, and Astro DB all switched defaults to Drizzle** (mid-2025)
- Prisma remains industry standard for large teams but Drizzle now the default for modern indie/startup stacks
- Prisma's Rust-free client + driver adapters not yet released; roadmap ongoing

### Migration Tooling
- Drizzle Kit: Schema-first, no code generation
- Prisma: Mature migrations with `prisma migrate`, but requires generate step
- **Verdict for Vercel serverless:** Drizzle wins on cold-start and DX; Prisma wins on ecosystem and support

### Free Tier / Managed Options
- Prisma Compute free: 1M requests/mo, 360 GB-hours/mo, 4 vCPU-hours/mo, 10GB bandwidth
- Drizzle: No managed service; use with self-hosted or third-party Postgres

---

## 2. Managed Postgres for Vercel Serverless

### Top Contenders (2026)

**Neon** (Best for Vercel)
- 500 MB storage, 100 CU-hours/month (compute), 5 GB egress
- Connection pooling included (PgBouncer-based, 10K pooled connections)
- Powers Vercel Postgres natively; HTTP serverless driver works in edge runtimes
- Scale-to-zero compute; auto-suspend after monthly limit

**Supabase** (Best if you need integrated ecosystem)
- 1 GB storage, 2 GB bandwidth/month
- PgBouncer pooling (must use "Transaction mode" for serverless)
- Integrated: Auth, Storage, Edge Functions, Realtime
- Not as optimized for Vercel as Neon but full-stack developer-friendly

**Vercel Postgres** (Easiest Vercel integration)
- Built on Neon infrastructure; Vercel-flavored SDK
- Same limits as Neon but billing rolled into Vercel Pro
- No separate account management
- Best if already committed to Vercel ecosystem

### Connection Pooling Notes
- All three include pooling; Neon + Vercel native, Supabase requires explicit "Transaction mode" string
- Essential for serverless to avoid connection exhaustion

### 2025-2026 Updates
- Neon remains most performant for serverless compute
- No major suspensions/sleep concerns; clear free → paid paths
- Vercel Postgres increasingly recommended for Vercel-first teams

---

## 3. Background Jobs & Scheduled Tasks for Vercel

### Top Contenders (2026)

**Vercel Cron** (Simplest)
- Built into Next.js App Router (`/api/cron`)
- Simple, no external dependencies
- Free on Hobby tier
- Downside: ~1-minute intervals minimum, no guaranteed execution on Hobby

**Inngest** (Best for event-driven workflows)
- 50,000 executions/month free (note: an execution = 1 run + all steps inside)
- Local dev server included; full TypeScript SDK
- Durable, retryable multi-step workflows
- Deploys alongside Next.js on Vercel

**Trigger.dev** (Best for traditional job queue)
- ~50K job runs/month free tier (separate metric from Inngest)
- Deploy workers to Trigger.dev infrastructure
- Long-running async tasks as plain TypeScript functions
- Realtime progress updates

**QStash** (Lightest HTTP-based option)
- Pay-per-message model (Upstash)
- Guaranteed delivery, scheduling, retries
- Trigger your existing API endpoints
- No new infrastructure needed

### Recommendation Matrix
- **Simple cron**: Use Vercel Cron + QStash to trigger reliable endpoints
- **Event-driven multi-step**: Use Inngest (best free tier for complexity)
- **Long-running tasks**: Use Trigger.dev
- **Hybrid:** Inngest + Vercel Cron (cron triggers Inngest events)

---

## 4. File/Object Storage Free Tiers

### Top Contenders (2026)

**Cloudflare R2** (Best value, standout choice)
- 10 GB free storage, **zero egress fees** (huge advantage), S3-compatible API
- Free tier is permanent; no upgrade required for small projects
- Best for egress-heavy workloads

**Vercel Blob** (Best Vercel integration)
- 1 GB storage, 10 GB data transfer on Hobby
- Built-in signed URL support
- OIDC auth by default (no long-lived secrets)
- Seamless Vercel Functions integration

**Supabase Storage** (Best if using Supabase DB)
- 1 GB storage, 2 GB bandwidth/month
- Integrated with Supabase Auth (row-level security)
- Database + auth + storage in one product

**UploadThing** (TypeScript-first managed service)
- Managed file uploads for TypeScript teams
- Presigned URL plumbing handled
- Free tier limits unclear in 2026 docs; suitable for small teams

### Verdict
- **Recommendation:** Cloudflare R2 for cost (zero egress), Vercel Blob for ease, Supabase Storage if already integrated

---

## 5. Transactional Email Free Tiers

### Top Contenders (2026)

**Resend** (Best for indie/startups)
- 3,000 emails/month free, permanent
- 100 emails/day limit (so ~3K/mo practical cap)
- Developer-friendly TypeScript API
- Increasingly default for modern Next.js stacks

**Postmark** (Best deliverability)
- 100 emails/month trial tier; then paid ($15/mo for 10K)
- Strongest inbox placement reputation
- Excellent support

**AWS SES** (Best at scale)
- 3,000 emails/month free for 12 months
- Then $0.10 per 1,000 emails (lowest cost at volume)
- 62K free from EC2 instances in same region
- Most complex setup

**SendGrid** (Discontinued free tier)
- Retired permanent free plan May 27, 2025
- Now: 60-day trial (100/day), then $19.95+/month plans only
- No longer recommended for indie free-tier projects

### Verdict
- **For free tier:** Resend (3K/mo permanent) beats SendGrid (discontinued) and Postmark (100/mo)
- **For scale:** AWS SES ($0.10/1K after free period)
- **For reliability:** Resend (modern API + good reputation) or Postmark

---

## 6. Clerk Organizations + Stripe Billing Integration

### Current State (2026)
- Clerk has **Organizations** feature (RBAC, multi-tenant)
- Clerk **does NOT have its own billing product** (as of Sept 2026)
- No major 2025-2026 shifts announced for integrated Clerk billing

### Integration Approach
- **Still hand-rolled:** Subscribe to Clerk Organization webhook (org created/updated/deleted)
- Sync organizations to Stripe as customers
- Create Stripe subscriptions manually in your backend
- No out-of-the-box Clerk-Stripe integration

### Tooling
- Clerk API: `useOrganization()`, webhooks for lifecycle events
- Stripe API: Create customers, subscriptions on org signup
- Pattern: Clerk webhook → create Stripe customer → create subscription

### Implications for This Project
- **Budget impact:** No surprise—expect 2-3 days of custom Stripe sync code
- **Complexity:** Moderate; clear separation of concerns (Clerk auth, Stripe billing)
- **Recommendation:** Hand-roll subscription sync using Inngest or Vercel Cron for reliability

---

## Summary Table

| Layer | Best Free Option | Free Tier Limit | Notes |
|-------|------------------|-----------------|-------|
| **ORM** | Drizzle ORM | N/A (self-hosted) | 31KB bundle, no code gen |
| **Postgres** | Neon | 500MB / 100 CU-hrs | Vercel-native, pooling included |
| **Background Jobs** | Inngest | 50K executions/mo | Event-driven, local dev |
| **File Storage** | Cloudflare R2 | 10GB, zero egress | Zero-egress is the win |
| **Email** | Resend | 3K emails/mo | Permanent free, dev-friendly |
| **Billing Sync** | Hand-rolled | N/A | Clerk → Stripe via webhooks |

---

## Cost-Optimized Stack Recommendation (2026)

```
Frontend/Hosting:   Vercel (Hobby, free)
Next.js:            App Router, React, TypeScript, Tailwind
Auth + Org:         Clerk (Pro $25/mo for organizations)
Database:           Neon (free tier)
ORM:                Drizzle ORM (self-hosted)
Jobs:               Inngest (50K executions free) + Vercel Cron
File Storage:       Cloudflare R2 (free tier) or Vercel Blob
Email:              Resend (3K/mo free)
Subscriptions:      Stripe + hand-rolled sync
Error Tracking:     Sentry (Student Team plan)
Payment:            Stripe (free tier until first charge)
```

**Estimated Monthly Cost at Launch:**
- Clerk Pro: $25
- Stripe: $0 (free until first charge)
- Everything else: Free tier

---

## Sources

1. [Drizzle vs Prisma ORM in 2026: A Practical Comparison](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
2. [Drizzle ORM vs Prisma: TypeScript Comparison (2026)](https://www.bytebase.com/blog/drizzle-vs-prisma/)
3. [Neon vs Supabase: Serverless Postgres Compared (2026)](https://getautonoma.com/blog/supabase-vs-neon)
4. [Neon Database Review: Serverless Postgres Branching](https://getautonoma.com/blog/neon-database)
5. [Vercel cron alternative: Background Jobs (2026)](https://dev.to/mike_tickstem/vercel-cron-alternative-what-to-use-when-built-in-cron-isnt-enough-52dp)
6. [Best Inngest Alternatives (2026): Pricing](https://www.buildmvpfast.com/alternatives/inngest)
7. [Background Jobs Pricing Comparison (June 2026)](https://www.buildmvpfast.com/api-costs/background-jobs)
8. [Storage & CDN Comparison 2026](https://agentdeals.dev/storage-comparison-2026)
9. [Cloudflare R2 Hands-On Guide: 10GB Free Storage](https://dev.to/yeagoo/cloudflare-r2-hands-on-guide-set-up-free-10gb-storage-zero-egress-object-storage-and-325n)
10. [Email API Pricing Comparison (July 2026)](https://www.buildmvpfast.com/api-costs/email)
11. [Resend vs SendGrid vs Postmark (2026)](https://www.buildmvpfast.com/blog/resend-vs-ses-vs-postmark-transactional-email-deliverability-saas-2026)
12. [Prisma Pricing & Free Tier](https://www.prisma.io/pricing)
13. [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
14. [Neon Pricing](https://neon.com/pricing)
15. [Inngest Pricing](https://inngest.com/pricing)
16. [Vercel Blob Documentation](https://vercel.com/docs/storage/vercel-blob)
17. [Resend Pricing](https://resend.com/pricing)
