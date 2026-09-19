# Analytics

## Overview

Product analytics through PostHog's EU cloud, plus the consent flow that gates the browser script. Server side events carry the funnel; the browser only counts page views. Error tracking sits beside it in `src/observability/`. Both are settled by [spec 0019](../../docs/specs/0019-product-analytics-and-error-tracking/index.md).

## Key files

| File | Owns |
|---|---|
| `src/analytics/events.ts` | The event catalogue: every event as a typed constant with a Zod schema for its properties |
| `src/analytics/client.ts` | The five calls (`track`, `identify`, `groupIdentify`, `deletePerson`, `flush`). Parses properties, never throws, does nothing when unconfigured |
| `src/analytics/sink.ts` | The real PostHog sink, a silent one, and a recording one for tests. The only file importing `posthog-node` |
| `src/analytics/provider.tsx`, `browser.ts` | The browser page view provider, mounted for every route except `/portal`. The only place importing `posthog-js` |
| `src/analytics/consent*.ts` | The first party consent cookie and its one public Server Action |
| `src/analytics/after-response.ts` | Schedules a flush with `after()` so a response never waits on PostHog |
| `src/observability/` | Every Sentry call the server makes, and the checks for whether each provider is configured |
| `src/lib/scrub.ts`, `src/observability/sentry-scrub.ts` | What is removed from an event before it leaves |

## Conventions

- Nothing outside `src/analytics/` imports `posthog-node` or `posthog-js`. Nothing outside `src/observability/`, the three Sentry config files, `src/instrumentation.ts`, the error boundaries and a short list of named callers imports `@sentry/nextjs`. Spec 0019 lists the callers; review enforces it, there is no lint rule yet.
- A property is an id, a literal from a declared union, a boolean, an integer count or an ISO date. Never a free string. A catalogue test fails on a key matching email, name, amount, title, note, file, address, phone or description.
- Actions fire events through the `track` slot on `withTenantAction`, after the handler resolved and any transaction committed. `distinctId` and `orgId` come from the context, never from the action.
- A webhook or reconcile event fires only after its transaction committed.
- Every call is fire and forget and a provider failure never changes an action's result or a page's render.
- Portal events carry no person id, use `distinctId` of the form `client:<client_id>` and set `$process_person_profile: false`. No PostHog script runs under `/portal`.
- New environment variables go through `src/lib/env.ts` like any other.

## Gotchas

- **Neither SDK makes a network call outside Vercel production and preview.** Local development, tests and CI stay silent.
- **No PostHog cookie exists before the visitor accepts.** Until then the browser runs on memory only persistence.
- **`onboarding.started` may repeat** and is not fired from a new `users` row. `ensureUserRow` is shared with the Clerk webhook and invitation acceptance, so that would profile a client contact.
- **Sentry replay is on error only and fully masked**, whatever the consent cookie says.
- **Erasure completes at the provider** when the Clerk webhook scrubs a user locally. The `analytics_erasure` sweep retries it. It needs the private key pair, and is skipped with a reason without it.

## Related specs

- [Spec 0019](../../docs/specs/0019-product-analytics-and-error-tracking/index.md): the catalogue, consent, scrubbing and the invariants above

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
