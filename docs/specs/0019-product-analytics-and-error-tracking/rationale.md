# 0019. Product analytics and error tracking: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file is for a person asking why.

## Context

> ⚠️ Premise note: this topic spans three decisions that usually get three specs: error tracking, product analytics, and cookie consent (which was deferred in the scope and pulled forward during design because page views need a browser script). They stay in one spec because one rule governs all three, namely what may leave the app about a person, and splitting them would put that rule in three places. Terms of service and a lawyer reviewed privacy policy are explicitly out; `/privacy` here is an honest notice, not a policy.

The product runs on Vercel with no visibility beyond stdout. Spec 0003, spec 0012, spec 0015, spec 0017 and spec 0018 each deliberately wrote structured JSON log lines and left "error tracking is feature 20's decision" as a comment, so today a thrown Server Action, a failed sweep or a broken webhook is a line in Vercel's log viewer that nobody is watching. Spec 0001 chose Sentry for errors and traces, on a student Team plan that lasts one year and stops collecting rather than billing when its quota runs out. It also listed the four Sentry environment variables and left them commented out in `.env.example`. Nothing in `src/` mentions Sentry yet.

The second half of the feature has no prior decision at all. The scope wants to know which signups activate and which convert to a paid subscription. That question has a shape: five events in order (reaching onboarding, agency, first invoice, checkout, paid subscription), each of which happens on the server, two of them inside webhooks. The app also has a second population, the agencies' clients, who visit a read only portal and whose data belongs to the agency, not to this product. Whatever collects product events has to be able to say what it knows about those people, and the answer the product wants to give is nothing.

Four forces shape the answer. The budget is free tiers plus the Sentry plan, so any collector must fit a free tier at demo scale and must fail quietly, not expensively, when it does not. Personal data is in scope: staff emails, contact emails and Clerk ids are personal data under GDPR, agencies may be in the EU, and the scope row says neither collector may leak any of it. The stack is settled (Next.js 16 on Vercel, Server Actions behind `withTenantAction`, structured console logging, no Redis after spec 0018), so anything chosen has to run inside a serverless function that freezes as soon as the response is sent. And the codebase already has a pattern for "a provider that may be unconfigured": `RESEND_API_KEY` and the four R2 variables are optional outside production, with a console transport or a visible notice standing in.

Not deciding means shipping to real agencies blind: no error reaches anyone, the conversion question stays unanswerable, and the first browser script anyone adds later drags cookie consent in unplanned.

## Options considered

### Option 1: Sentry only, plus Vercel Web Analytics for page views

Install Sentry across the three runtimes and switch on Vercel Web Analytics for page views. No product events, no second provider, no consent question beyond what Vercel's cookieless page view script already avoids. The conversion funnel is read by hand from the `subscriptions` table and Clerk's dashboard.

**Pros**:
- Smallest surface: one new dependency, one dashboard, zero new privacy exposure beyond errors.
- Nothing to keep honest: no event catalogue, no property rules, no erasure hook.

**Cons**:
- The scope's stated goal (which signups activate and convert) is not answered by any tool; it is a SQL query someone runs when they remember.
- Vercel Web Analytics custom events need the Pro plan and the Hobby event cap is small, so it can never grow into the funnel.
- Feature usage and portal adoption stay invisible.

### Option 2: Sentry for errors, PostHog EU for analytics, server side events, cookieless until consent (chosen)

Sentry keeps the job spec 0001 gave it, in all three runtimes, with a scrub function and ids only. PostHog's EU cloud gets a typed event catalogue fired from Server Actions (through a declarative slot on `withTenantAction`), from the two webhooks after their transactions commit, and from the portal pages anonymously. The browser only counts page views, through a first party rewrite, in memory until a person accepts a cookie. A banner and a `/privacy` page carry the consent.

**Pros**:
- Answers the funnel question with events that cannot be blocked, double fired or inflated by a retry, because they fire where the state changes.
- PostHog's free tier (around a million events a month as of mid 2026) covers demo scale many times over, and its EU region and cookieless mode exist because this exact privacy posture is common.
- Contacts are outside the system entirely; the sentence "we never profile your clients" is true by construction.
- The consent debt is paid in its smallest form now, while the only cookie in question is one the product controls.

**Cons**:
- A second provider, nine more environment variables, two more dashboards and two DPAs.
- Group analytics (agency level properties) may be a paid add on on PostHog's free plan, so agency breakdowns of ordinary events may not be queryable; the billing events carry the status as a plain property to keep the funnel safe.
- Browser errors from ad blocked clients are lost because no Sentry tunnel is configured, a deliberate trade to keep function invocations off the free tier.

### Option 3: PostHog for both errors and analytics

PostHog now ships error tracking. One SDK in the browser, one on the server, one dashboard, one DPA, and an issue that links straight to the person's events.

**Pros**:
- Fewest moving parts of any option that answers the funnel: one provider, one set of keys, one privacy story.
- The person to error link is native rather than a shared `org_id` tag.

**Cons**:
- Walks away from spec 0001's decision and from a year of paid Sentry, for an error product that is younger and thinner (no edge runtime story of equal maturity, less mature source map and replay tooling as of mid 2026).
- Puts every egg in the one basket whose free tier is measured in events, so a noisy error loop eats the analytics quota too.

### Option 4: A local `analytics_events` table, no third party

Write every event into Postgres through the tenant layer, prune it in the daily sweep, and answer the funnel with SQL. Sentry stays for errors.

**Pros**:
- No third party ever sees a product event; erasure is a `delete` you already know how to write.
- Survives any provider going away or changing its free tier.

**Cons**:
- A migration, a retention sweep, a tenant scoping question (events span the agency and the operator), and no funnel, cohort or dashboard until you build one.
- Page views would need a route handler of your own, which is a public unauthenticated write endpoint to rate limit and protect.
- Solves a problem the product does not have yet (provider lock in) at the cost of the one it does (nobody can see the funnel).

## Rationale

Option 2 is chosen because the two forces that matter most, the privacy posture and the free tier budget, both push the same way: put the events on the server where they are true and cheap, send only ids, and keep the browser's job small enough that losing it costs nothing. The thing that makes analytics dangerous in a multi tenant product is not the provider, it is a free string property that one day carries an invoice title or an email; the `Properties` type and the catalogue test exist so that mistake is a compile error, not a code review catch. Taking `distinct_id` and `org_id` from the tenant context rather than from an action input applies spec 0003's load bearing rule to a new sink: an action cannot mis attribute an event any more than it can mis scope a query.

Sentry stays because spec 0001 chose it, the year is paid for, and its Next.js SDK is the boring, well trodden choice for exactly this app shape (three runtimes, source maps on Vercel, `onRequestError`). Option 3's single dashboard is attractive and is the named fallback for the day the student plan ends, but it is not worth abandoning a settled, paid decision today. Option 1 is honest about cost but does not do the job the scope asked for, and Option 4 builds infrastructure to avoid a dependency the product can afford.

The engineer pulled cookie consent forward rather than accepting a cookieless only browser script. That is the right call once page views are in scope: a consent banner added later, under pressure, is where products end up with a pre checked box. The cookieless until accepted model keeps every page view before the click, which is what makes the banner cheap to ship now. Session replay on error runs regardless of the cookie because it stores nothing in the browser, masks everything, and only exists to diagnose a failure the person just hit; `/privacy` says so in those words, which is what legitimate interest requires.

Three settled by recommendation rather than by the engineer, with the runner up for each: `after()` for flushing (runner up: awaiting the flush inline, which adds a round trip to every write); no Sentry tunnel (runner up: `tunnelRoute`, which is one function invocation per browser event); and the erasure retry as a sweep over recently scrubbed users (runner up: a pending erasures table, which would have been the feature's only migration for one rarely taken path).

## Design conversation record

Answers given during the staged design, kept so a later reader can see what was chosen against what:

- Runtimes: all three (Node, browser, edge). Runner up: Node and browser only.
- Analytics questions: the funnel, feature usage, portal usage, and page views. Portal usage reconciled with staff only tracking by making portal events anonymous and keyed to the agency and client.
- Tracked people: agency staff only.
- Activation: first invoice issued. Runner up: first client created.
- Alerts: email on every new production Sentry issue only. Declined: quota threshold email, a Cron monitor on the daily sweep, analytics failure alerts.
- Promoted log signals: cron sweep failures and webhook throws; `access.invariant` and `tenant.escape_hatch`. Left as log lines: `rate_limit.skipped`, `tenant.refusal`, `rate_limit.refused`.
- Persistence: provider only, no local table. Person id: the Clerk user id. Person properties: role and created date. Agency properties: subscription status and dates, created date and team size.
- Provider: PostHog Cloud EU. Runner up: Mixpanel. Capture: server for business events, browser for page views only.
- Agent Skill and MCP discovery for PostHog: not now, later.
- Cookies: pull consent forward. Consent model: cookieless until accepted. Consent store: a first party cookie for one year. Privacy page: a short `/privacy`. Portal: no script, no banner.
- Proxies: PostHog through a rewrite, no Sentry tunnel. Environments: production and preview only.
- Event catalogue: the full list as drafted. Capture API: a declarative `track` slot. Flushing: `after()`. Replay: masked, on error, regardless of consent.
- Erasure: delete the PostHog person from the Clerk webhook. PII guard: typed properties plus a catalogue test. Missing keys: the app runs with the collector off. Error page: message, retry, and the Sentry reference id.
- References: none.
- Cross check (another model) after the draft: six gaps applied. The Sentry tags move to `context.ts`; webhook and sweep signals pass `org_id` explicitly; the browser identity comes from `useAuth()` behind the `clerkLive` gate; the first funnel step became `onboarding.started` (firing on a new user row would have profiled contacts, because invitation acceptance creates one too); `trial_end` is parsed from Stripe and passed in memory; `ErrorState` gains a `reference` prop.
