# 0019. Product analytics and error tracking

**Date**: 2026-09-18
**Status**: In Progress

## Summary

Errors go to Sentry (already chosen in spec 0001 and already paid for) from all three places the app runs: the Node server, the browser, and the edge proxy. Product events go to PostHog's EU cloud, and every event that matters for the funnel (onboarding started, agency created, first invoice issued, checkout started, subscription started) fires on the server where the truth is, so an ad blocker cannot make the numbers lie. Only ids, roles, dates and counts ever leave the building: no email, no name, no money amount, and your customers' clients are never profiled at all. The browser script only counts page views, runs without a cookie until the person accepts one, and a small banner plus a plain `/privacy` page cover the consent that pulls forward from the deferred legal pages.

## Requirements

**User stories**:
- As the operator, I want a production error to reach me with a readable stack trace and the agency it hit, so that I can fix it before the agency writes in.
- As the operator, I want to see how many signups create an agency, issue an invoice, and pay, so that I know where the product loses people.
- As an agency staff member, I want the product to keep working when a monitoring provider is slow or down, so that observability is never the reason I cannot invoice.
- As a person visiting the app, I want to be told plainly what is collected and to say no to cookies without losing anything, so that I can trust the product with my clients' data.
- As a client contact in the portal, I want no banner, no cookie and no profile of me anywhere, so that my agency's promise to me holds.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

*Error tracking*

- **AC-1**: `@sentry/nextjs` (current major, 9 or later; the file names below are that major's convention, so verify them against the version actually installed before writing them) is initialised in all three runtimes: `src/instrumentation-client.ts` (browser), `sentry.server.config.ts` (Node) and `sentry.edge.config.ts` (edge), the last two loaded from `src/instrumentation.ts`'s `register()` by `process.env.NEXT_RUNTIME`, with `export const onRequestError = Sentry.captureRequestError`. `next.config.ts` is wrapped with `withSentryConfig`. A thrown error in a Server Component, a Server Action, a route handler, `src/proxy.ts`, and a client component each produce exactly one Sentry event, and the event's runtime tag says which of the three it came from.
- **AC-2**: The SDK sends only from Vercel production and preview. `environment` is `VERCEL_ENV` on the server and `NEXT_PUBLIC_VERCEL_ENV` in the browser, `release` is `VERCEL_GIT_COMMIT_SHA`, and `enabled` is true only when the DSN is set and the environment is `production` or `preview`. Local development, `NODE_ENV=test`, and CI make no network call to Sentry; a unit test covers the `enabled` predicate for all five cases (production, preview, development, test, unset).
- **AC-3**: Source maps upload on every build that has `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` set, with `widenClientFileUpload: true` and the maps deleted from the deployed output after upload. Without the token the build completes with no upload and no failure. A production error's stack trace in Sentry shows the original TypeScript file and line, not the minified bundle. `next.config.ts` reads the three variables straight from `process.env`, a named exemption to the `env()` rule, because `env()` validates the whole schema and a build must not need database credentials.
- **AC-4**: No personal data reaches Sentry. `sendDefaultPii` stays false and no `dataCollection` object is passed. A shared `scrubEvent` function, used as `beforeSend` and `beforeSendTransaction` in all three runtimes, removes `request.headers`, `request.cookies`, `request.data`, `request.query_string`, every `user` field except `id`, and any breadcrumb of category `console` whose message contains an `@`. Every event carries the tag `org_id` (the local `organizations.id`) whenever a tenant context resolved, and `user.id` set to the Clerk user id for staff and contact sessions alike; both are set once per request by `resolveStaffContext` and `resolveContactContext` in `src/db/tenant/context.ts`, the two places that join a Clerk session to a local `orgId` (`src/db/tenant/session.ts` only wraps `auth()` and never knows the local id). Webhooks and the cron route never resolve a tenant context, so their events carry `org_id` only where AC-6 passes it explicitly. A unit test feeds `scrubEvent` an event carrying headers, cookies, a body, an email in `user`, and a console breadcrumb with an address, and asserts all of them are gone and `user.id` and `org_id` survive.
- **AC-5**: Quota is protected by configuration, not hope. `tracesSampleRate` is `0.1` in production and preview; a `tracesSampler` returns `0` for any transaction whose name starts with `/api/cron` or `/api/webhooks`, so scheduled and retried traffic never burns quota (errors there are still captured, sampling only affects traces). Session replay runs with `replaysSessionSampleRate: 0`, `replaysOnErrorSampleRate: 1`, `maskAllText: true`, `maskAllInputs: true` and `blockAllMedia: true`, buffered in memory and sent only when an error occurs, in every environment where the SDK is enabled and regardless of the consent cookie. The replay integration is loaded lazily so it stays out of the first paint bundle.
- **AC-6**: Four existing signals are promoted to Sentry alongside their log line, with the same fields the line carries and never any row contents: `access.invariant` and `tenant.escape_hatch` (`Sentry.captureMessage`, level `error`), a sweep whose report is `failed` (`captureMessage` with the sweep name and its `error` text, from the runner in `src/cron/runner.ts`), and an error thrown by either webhook handler (`captureException` before the handler rethrows, so the provider still retries). These sites run under `withSystemAccess` with no tenant context, so each passes `org_id` as an explicit tag where it knows it: the Stripe handler once it has resolved the agency from the customer or metadata, the Clerk handler once it has mapped the organization event to a local row, and a failed sweep with no `org_id` at all (a sweep spans every agency). Each is fingerprinted by event name plus operation or sweep name, so each kind groups into one issue. `tenant.refusal`, `tenant.system_access`, `rate_limit.refused` and `rate_limit.skipped` stay log lines only.
- **AC-7**: Client side render errors are reported. `src/app/global-error.tsx` and every existing `error.tsx` boundary call `Sentry.captureException(error)` once when they mount (a shared `useReportedError(error)` hook in `src/ui/patterns/` for the segment boundaries; `global-error.tsx` imports `@sentry/nextjs` directly because it deliberately imports no shared module). Each boundary shows the Sentry event id under the existing message as `Reference: <id>` when one exists, and nothing when the SDK is disabled; `ErrorState` gains one optional `reference?: string` prop rendered as plain text below the description, and the id comes from the return value of `captureException` (verify against the installed major whether `Sentry.lastEventId()` is still the top level export; the return value is the safer source). Focus lands on the message region as it does today, the reference is plain text a screen reader reads in order, and axe stays clean in both themes.
- **AC-8**: The Sentry project has one alert rule: email on every new issue, filtered to `environment:production`. This is a dashboard setting; `verify.md` records it, and the verify walk proves it with one deliberate production error that arrives as an email.

*Product analytics*

- **AC-9**: `src/analytics/` holds the catalogue and the client. `events.ts` declares every event below as a typed constant with a Zod schema for its properties. `track()` accepts only `Id` (a branded string: a local uuid, a Clerk id, or a Stripe id), a string literal union, `boolean`, an integer count, or an ISO date; a plain `string` property is a compile error. A unit test walks every declared event and every person and group property and fails on a key matching `/email|name|amount|title|note|file|address|phone|description/i`. Nothing outside `src/analytics/` imports `posthog-node` or `posthog-js`.
- **AC-10**: `withTenantAction` gains one declarative slot, `track?: { event, properties?: (input, result) => Properties }`, in the shape of spec 0018's `rateLimit` (today typed `never` and unbuilt; whichever of 0018 and 0019 builds first sets the slot pattern and the other follows it). The wrapper fires it only after the handler resolved and, when `transaction: true`, after the commit; never on a parse failure, a role or subscription refusal, a rate limit refusal, or a thrown handler. `distinctId` is `ctx.clerkUserId` and `orgId` is `ctx.orgId`, never supplied by the action. The flush is scheduled with `after()` from `next/server`, so the response never waits on PostHog. A unit test proves the four no fire cases and the one fire case with a fake sink.
- **AC-11**: The funnel spine fires from the server, exactly once per real transition, except the first step which tolerates repeats: `onboarding.started` from the `/onboarding` page's Server Component render (the create agency form, which only a signed in person with no agency reaches; contact sessions are sent to `/portal` by spec 0014), queued with `after()`, and allowed to repeat on every render because PostHog funnels count unique persons per step, so a repeat cannot inflate it. It is deliberately not fired on a new `users` row: `ensureUserRow` in `src/db/tenant/provisioning.ts` is an upsert shared by the Clerk webhook, the nightly reconcile and invitation acceptance, and a contact accepting an invite also triggers Clerk's `user.created`, so "new user row" would profile a contact. `ensureUserRow` is untouched. Then `agency.created` from `createAgency`; `invoice.issued` from `issueInvoice` with `is_first: true` exactly when the agency's count of invoices with `issued_at` not null is `1` after this issue, counted inside the same transaction through the scoped accessor's `select` with Drizzle's `count()`; `checkout.started` from `startCheckout`; `subscription.started` when `applySubscriptionState` moves an agency's row to `active` from no row or from any status other than `active`, and `subscription.changed` with `status` on every other status change, both fired by the webhook and by the nightly Stripe reconcile alike (whichever sees the transition first) and only after that transaction commits. `applySubscriptionState` selects the existing `status` alongside the customer id and returns `{ outcome, transition }` where `transition` is `"started" | "changed" | "none"`, computed by a pure `subscriptionTransition(previous, next)` with its own unit test.
- **AC-12**: The rest of the catalogue fires as listed in the design table: `client.created`, `project.created`, `deliverable.uploaded`, `deliverable.shared` (only when visibility flips to visible), `contact.invited`, `contact.accepted`, `team_member.invited`, `team_member.joined`, `invoice.paid`, `invoice.voided`, `invoice.pdf_downloaded`, `portal.viewed`, `portal.invoice_viewed`, `portal.file_downloaded`. Portal events carry `org_id` and `client_id`, use `distinctId` of the form `client:<client_id>`, and are sent with `$process_person_profile: false`, so no person record ever exists for a contact. A unit test asserts every portal event's properties contain no `user_id` and no `contact_id`.
- **AC-13**: Person and group properties are the whole allowed set and nothing else. `identify(clerkUserId, { role, created_at })` runs on `agency.created`, `team_member.joined` and `changeTeamMemberRole`. `groupIdentify("agency", orgId, { subscription_status, trial_ends_at, subscribed_at, created_at, team_size })` runs on `agency.created`, every subscription transition, and every membership insert or removal, with `team_size` counted in that same transaction (the scoped accessor's `select` with `count()`, as for `is_first`). `trial_ends_at` has no local column and is never read back from a row: `retrievedSubscription` in `src/payments/events.ts` gains `trial_end` (a nullable Stripe timestamp) and the webhook and reconcile call sites pass it in memory to `groupIdentify`; it is `undefined` when Stripe sends none. `subscription_status` is also stamped as an event property on `checkout.started`, `subscription.started` and `subscription.changed`, so the funnel can be broken down by it even where group analytics is not enabled on the PostHog plan.
- **AC-14**: Page views come from the browser through one client component, `AnalyticsProvider` in `src/analytics/provider.tsx`, mounted by the root layout for every route except those under `/portal`, and only when the public key is set and `NEXT_PUBLIC_VERCEL_ENV` is `production` or `preview`. It initialises `posthog-js` with `autocapture: false`, `disable_session_recording: true`, `capture_pageview: false`, `advanced_disable_feature_flags: true`, `persistence: "memory"`, and captures `$pageview` itself on mount and on every `usePathname` change with `$current_url` reduced to origin plus pathname (no query string, no hash). No script, request or cookie from PostHog ever appears on a `/portal` page; a browser test asserts it.
- **AC-15**: On a signed in agency page the provider calls `posthog.identify(clerkUserId)` with no properties, so page views join the person the server side events belong to. `IdentityProvider` carries only `clerkLive` and stays that way; `AnalyticsProvider` renders an inner `IdentifiedAnalytics` component only when `useClerkLive()` is true, and that inner component reads `userId` from Clerk's `useAuth()`, which keeps every hook call unconditional in the way the shell already requires. A signed out visitor is an anonymous memory only id and is not stitched across visits.
- **AC-16**: PostHog traffic goes through this app's domain. `next.config.ts` adds `rewrites` for `/ingest/static/:path*` to `https://eu-assets.i.posthog.com/static/:path*` and `/ingest/:path*` to `https://eu.i.posthog.com/:path*`, with `skipTrailingSlashRedirect: true`; the browser client's `api_host` is `/ingest` and `ui_host` is `https://eu.posthog.com`. No Sentry `tunnelRoute` is configured. `src/proxy.ts` leaves `/ingest` paths untouched.

*Consent and privacy*

- **AC-17**: The consent choice is one first party cookie, `clienthq_consent`, with value `accepted` or `declined`, `Max-Age` of one year, `Path=/`, `SameSite=Lax`, `HttpOnly`, and `Secure` outside development. It is written by a public Server Action `setCookieConsent(choice)` in `src/analytics/consent.ts` that parses `choice` with Zod as `"accepted" | "declined" | "undecided"` (`undecided` deletes the cookie), touches no database and needs no session. A missing or malformed cookie reads as `undecided`; a pure `readConsent(value)` with a unit test decides that.
- **AC-18**: When consent is `undecided`, every page outside `/portal` renders a banner from the root layout: a `<section aria-label="Cookie preferences">` fixed at the bottom of the viewport, not a dialog, no focus trap, reachable by keyboard in document order, with one sentence saying page view analytics run without cookies until accepted, a link to `/privacy`, and two buttons of equal visual weight, `Accept` and `Decline`. Either button calls `setCookieConsent`, the banner disappears without a reload, and `AnalyticsProvider` switches persistence to `localStorage+cookie` on `accepted` or stays in memory on `declined`. On a later visit the choice is honoured from the cookie on the server, so no banner flashes. A `Cookie settings` control on `/privacy` and in the user menu calls `setCookieConsent("undecided")`, which brings the banner back. Renders in the design system, both themes, axe clean, and the banner never covers the skip link target or the toast region.
- **AC-19**: `/privacy` is a public static page in `src/app/privacy/page.tsx`, in plain words: what is collected (errors and masked recordings on error by Sentry; product events, ids and page views by PostHog), the exact identifiers sent (Clerk user id, agency id, client id, role, dates and counts) and what is never sent (email, name, amounts, file names), that client contacts are never profiled and see no analytics script, that Sentry data lives in the EU or US region chosen at project creation and PostHog data in the EU, the providers' default retention as named in their dashboards, the consent cookie and how to change the choice. It is linked from the banner, the sign in and sign up pages, and the user menu. Heading structure and links pass axe.

*Erasure, failure and configuration*

- **AC-20**: When the Clerk reconcile scrubs a user (the `scrubbed` path in `src/auth/reconcile.ts`), `deletePerson(clerkUserId)` is queued in the same `after()` flush; it deletes the PostHog person and their events through the PostHog API with the personal key. A failure writes one log line `event: "analytics.erasure_failed"` carrying the Clerk user id and the error's `name`. A new sweep `analytics_erasure`, placed after `clerk_reconcile` and before `retention_prune` in `SWEEP_ORDER`, exists for exactly one failure: the `after()` callback never ran or its request failed (the function froze first, or PostHog was down). It is a retry, not a second erasure path: it re issues `deletePerson` for every local user with `deleted_at` within the last 7 days (idempotent, so a repeat is harmless), reports `persons_deleted` and `persons_failed`, and reports `skipped` with reason `analytics_unconfigured` when the personal key is unset. No new table.
- **AC-21**: Observability never takes the product down. `track`, `identify`, `groupIdentify`, `deletePerson` and every Sentry call are wrapped so they never throw into a caller; a provider error is swallowed and logged once as `event: "analytics.failed"` with the event name and the error's `name`, never the properties. When `NEXT_PUBLIC_POSTHOG_KEY` or `NEXT_PUBLIC_SENTRY_DSN` is unset, `isAnalyticsConfigured()` and `isSentryConfigured()` are false, every call is a no op, and a production process logs one line `event: "observability.unconfigured"` naming the missing keys the first time it is asked. Every provider variable is optional in every environment; `env.ts` gains no production refinement for them.
- **AC-22**: Tests never talk to a provider. `src/analytics/client.ts` exports `createAnalytics({ sink })` and the module's default instance is built from the environment; unit tests pass a fake sink and assert on the captured calls. `NODE_ENV=test` builds the no op client regardless of keys, and the Playwright suite runs with no provider variables and asserts no request leaves for `/ingest` or `sentry.io`.
- **AC-23**: New environment variables, all declared in `src/lib/env.ts` and documented in `.env.example`: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` (build only), `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (default `https://eu.i.posthog.com`), `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, plus the Vercel supplied `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV` and `VERCEL_GIT_COMMIT_SHA` as optional strings. The commented `UPSTASH_*` lines leave `.env.example`, as spec 0018 decided.

## Options considered

Reasoning and options: see [rationale.md](rationale.md).

## Decision

**Chosen option**: Option 2: Sentry for errors in all three runtimes plus PostHog EU for product analytics, with business events captured on the server, page views only in the browser, cookieless until consent.

Sentry keeps the job spec 0001 gave it, PostHog gets the funnel, and the rule that ties them together is that only ids, enums, dates and counts ever leave the app.

**Implementation skills**: `sentry-nextjs-sdk` (`getsentry/sentry-for-ai`, `.agents/skills/sentry-nextjs-sdk/`) · `nextjs-v16` (`vercel-labs/agent-skills`, `.agents/skills/nextjs-v16/`) · `gdpr-data-handling` (`.agents/skills/gdpr-data-handling/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `zod` (`.agents/skills/zod/`) · `vitest` (`.agents/skills/vitest/`) · `playwright-cli` (`.agents/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch**:

No local table changes. The model lives at the providers.

| Record (where) | Key | Properties allowed | Never sent |
|---|---|---|---|
| Person (PostHog) | `distinct_id` = Clerk user id | `role` (`admin` / `member`), `created_at` (from `users.created_at`) | email, name, image URL |
| Agency group (PostHog, `group_type: "agency"`) | `org_id` = local `organizations.id` | `subscription_status`, `trial_ends_at`, `subscribed_at`, `created_at`, `team_size` | agency name, client names, money |
| Event (PostHog) | name + timestamp | `org_id` always; `client_id` on portal events; the id of the thing acted on; `status`, `role`, `is_first` where listed | free text, email, amounts, file names, `user_id` on portal events |
| Error event (Sentry) | Sentry event id | tag `org_id`, `user.id` = Clerk user id, `runtime`, `environment`, `release`, stack trace, masked replay | headers, cookies, bodies, query strings, IP, email |

A Sentry event and a PostHog event share `org_id`, so an issue leads to the agency it hit. A person is scrubbed locally and deleted in PostHog by the same Clerk user id.

**Event catalogue** (all carry `org_id`; the funnel spine is in bold):

| Event | Fired from | Extra properties | `distinct_id` |
|---|---|---|---|
| **`onboarding.started`** | the `/onboarding` page render, repeats tolerated | none | Clerk user id |
| **`agency.created`** | `createAgency` | none | Clerk user id |
| `client.created` | `createClient` | `client_id` | Clerk user id |
| `project.created` | `createProject` | `project_id`, `client_id` | Clerk user id |
| `deliverable.uploaded` | `confirmUpload` | `deliverable_id`, `project_id` | Clerk user id |
| `deliverable.shared` | `setDeliverableVisibility`, visible only | `deliverable_id` | Clerk user id |
| `contact.invited` | `sendInvitation` | `client_id` | Clerk user id |
| `contact.accepted` | the portal accept flow | `client_id` | `client:<client_id>` |
| `team_member.invited` | `inviteTeamMember` | `role` | Clerk user id |
| `team_member.joined` | the Clerk membership reconcile, on insert | `role` | Clerk user id (the joiner) |
| **`invoice.issued`** | `issueInvoice` | `invoice_id`, `is_first` | Clerk user id |
| `invoice.paid` / `invoice.voided` | `markInvoicePaid` / `voidInvoice` | `invoice_id` | Clerk user id |
| `invoice.pdf_downloaded` | the staff PDF route | `invoice_id` | Clerk user id |
| **`checkout.started`** | `startCheckout` | `subscription_status` | Clerk user id |
| **`subscription.started`** | `applySubscriptionState`, transition `started` | `subscribed_at`, `subscription_status` | `org:<org_id>` (no person acted) |
| `subscription.changed` | `applySubscriptionState`, transition `changed` | `status`, `subscription_status` | `org:<org_id>` |
| `portal.viewed` | the `(contact)` portal pages, per render | `client_id`, `path` | `client:<client_id>` |
| `portal.invoice_viewed` | `/portal/invoices/[id]` | `client_id`, `invoice_id` | `client:<client_id>` |
| `portal.file_downloaded` | the download route, contact branch | `client_id`, `deliverable_id` | `client:<client_id>` |
| `$pageview` | `AnalyticsProvider`, agency and auth pages only | `$current_url` (origin + path) | Clerk user id when signed in, else anonymous |

Events whose `distinct_id` is not a Clerk user id are sent with `$process_person_profile: false`.

**State transitions**:

Consent: `undecided` → `accepted` or `declined` (banner buttons); `accepted` or `declined` → `undecided` (`Cookie settings`). Subscription transition for events: `none` when the status is unchanged, `started` on any move into `active` from no row or a status other than `active`, `changed` on every other change.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `track(event, { distinctId, orgId, properties })` in `src/analytics/client.ts` | function | the typed event constant, ids, properties matching its schema | `void`, queued; flushed by `after()` | server only, callers are actions, webhooks, routes | never throws; `analytics.failed` log line on provider error; no op when unconfigured |
| `identify`, `groupIdentify`, `deletePerson`, `flush` in `src/analytics/client.ts` | function | ids and the allowed property sets | `void` | server only | as above |
| `withTenantAction({ track })` in `src/db/tenant/action.ts` | slot | `event`, optional `properties(input, result)` | fires after success only | as the action | see AC-10 |
| `setCookieConsent(choice)` in `src/analytics/consent.ts` | Server Action | `choice: "accepted" \| "declined" \| "undecided"` | `{ ok: true }` | public, no session | `422` shaped `{ ok: false, error: { code: "invalid_input" } }` on a bad value |
| `GET /privacy` | page | none | the static notice | public | none |
| `GET /ingest/*` and `POST /ingest/*` | rewrite | PostHog's own payloads | proxied to PostHog EU | public, as PostHog's endpoint is | PostHog's own responses pass through |
| `scrubEvent(event)` in `src/observability/sentry-scrub.ts` | function | a Sentry event or transaction | the same event with the AC-4 fields removed | internal | none |
| `onRequestError` in `src/instrumentation.ts` | Next hook | error, request, context | one Sentry event | internal | none |
| `analytics_erasure` sweep in `src/cron/analytics-erasure.ts` | sweep | `db`, `now` | `SweepReport` with `persons_deleted`, `persons_failed` | the cron route's bearer secret | `skipped` with `analytics_unconfigured` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| every tracked action | `distinct_id`, `org_id` | `ctx.clerkUserId`, `ctx.orgId` from the tenant context (spec 0003); never an action input |
| every Sentry event | `org_id` tag, `user.id` | set by `resolveStaffContext` and `resolveContactContext` in `src/db/tenant/context.ts`; webhook and sweep events pass `org_id` explicitly where AC-6 says, else omit it |
| every Sentry event | `environment`, `release` | `VERCEL_ENV` / `NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA` (Vercel supplied, declared optional in `env.ts`) |
| `onboarding.started` | fired or not | the `/onboarding` page's Server Component rendered for a signed in person with no agency; never a user row insert |
| `identify` | `created_at` | `users.created_at` |
| `identify` | `role` | `memberships.role` of the membership just inserted or changed |
| `invoice.issued` | `is_first` | `count(*)` of the agency's invoices with `issued_at is not null` inside the issuing transaction, through the scoped `db`; `is_first = count === 1` |
| `subscription.started` / `.changed` | `transition` | `subscriptionTransition(previousStatus, subscription.status)`, with `previousStatus` selected in `applySubscriptionState` alongside `stripeCustomerId` |
| `subscription.started` | `subscribed_at` | the database clock at the transition (`now()` in the same transaction) |
| `groupIdentify` | `subscription_status`, `trial_ends_at`, `subscribed_at` | `subscriptions.status`; `trial_end` parsed into `retrievedSubscription` (`src/payments/events.ts`) and passed in memory from the webhook or reconcile call site, `undefined` when absent; the transition time above, unset until a `started` transition happens |
| `groupIdentify` | `team_size` | `count(*)` of active memberships for the agency in the same transaction as the membership change |
| `groupIdentify` | `created_at` | `organizations.created_at` |
| `checkout.started` | `subscription_status` | the agency's current `subscriptions.status`, or `none` when no row |
| portal events | `client_id`, `org_id` | the contact context (`kind: "contact"`) in spec 0003 and spec 0014's client resolution |
| `$pageview` | `$current_url` | `window.location.origin + pathname` in `AnalyticsProvider`; the query string and hash are dropped before capture |
| `identify` in the browser | the Clerk user id | Clerk's `useAuth().userId` inside `IdentifiedAnalytics`, mounted only when `useClerkLive()` is true |
| banner shown or not | consent state | `readConsent(cookies().get("clienthq_consent")?.value)` in the root layout |
| error boundaries | `Reference: <id>` | the id returned by `captureException` in the boundary, passed to `ErrorState`'s new `reference` prop |
| `deletePerson` | which person | the Clerk user id of the scrubbed row; the sweep lists `users.deleted_at >= now() - interval '7 days'` |
| `scrubEvent` | what to strip | the AC-4 list, fixed in code |

**Key invariants**:
1. Nothing outside `src/analytics/` imports `posthog-node` or `posthog-js`, and nothing outside `src/observability/`, the three Sentry config files, `src/instrumentation.ts`, the error boundaries, `src/db/tenant/context.ts`, `src/cron/runner.ts`, the two webhook handlers and `src/db/tenant/log.ts` imports `@sentry/nextjs`. Enforced by review now; a lint rule in the shape of `clienthq/no-raw-db-import` is a follow up.
2. A property sent to PostHog is an id, a literal from a declared union, a boolean, an integer count or an ISO date. Never a free string. Enforced by the `Properties` type and the catalogue test (AC-9).
3. A portal event never carries a person id and never creates a person profile (AC-12).
4. A tracked action event exists only if the action succeeded and its transaction committed (AC-10). A webhook or reconcile event exists only after its transaction committed (AC-11).
5. `subscription.started` fires at most once per real transition into `active`, whichever of the webhook or the nightly reconcile sees it first, because both go through `applySubscriptionState` under its row lock.
6. The SDKs make no network call outside Vercel production and preview (AC-2, AC-14, AC-22).
7. A Sentry event never carries headers, cookies, bodies, query strings, an IP or an email (AC-4).
8. A provider failure, timeout or missing key never changes an action's result or a page's render (AC-21).
9. No cookie from PostHog exists before `accepted`; no PostHog script exists under `/portal` (AC-14, AC-18).

**Security model**:

Compliance scope: **GDPR** applies. Agencies and their contacts may be in the EU, and a Clerk user id, an agency id and a role tied to a person are personal data even without a name. Both providers act as processors; PostHog data stays in the EU region and Sentry's region is chosen at project creation and recorded in `verify.md`. Consent for the analytics cookie is opt in, freely refusable at equal prominence, and revocable (AC-17, AC-18). Error tracking with masked replay on error and ids only rests on legitimate interest and is stated as such on `/privacy`. Erasure is completed at the provider by the same webhook that scrubs locally (AC-20). There is no product surface for any of this data: dashboards are the providers' own, reachable only by the operator's accounts, and nothing in the app reads back from a provider. The tenant layer is untouched because no rows are stored; the only cross tenant risk is a wrong `org_id` on an event, which is why AC-10 takes it from the context and never from an input. The `/ingest` rewrite is as open as PostHog's own endpoint and needs no limiter of its own. The Server Action `setCookieConsent` is public by design, writes one cookie and nothing else, and parses its one input with Zod. Secrets: `SENTRY_AUTH_TOKEN` exists only in Vercel's build environment; `POSTHOG_PERSONAL_API_KEY` is server only and scoped in the PostHog dashboard to person deletion; the two `NEXT_PUBLIC_` keys are public by design and identify a project, not a person.

**Configuration required**:
- `NEXT_PUBLIC_SENTRY_DSN`: the project DSN; unset means Sentry is off (`isSentryConfigured()` false)
- `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`: source map upload at build; read by `withSentryConfig` in `next.config.ts`, the token only ever set in Vercel's build environment
- `NEXT_PUBLIC_POSTHOG_KEY`: the PostHog project API key; unset means analytics is off (`isAnalyticsConfigured()` false)
- `NEXT_PUBLIC_POSTHOG_HOST`: the ingestion host, default `https://eu.i.posthog.com`; the server client sends there directly, the browser client through `/ingest`
- `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`: person deletion only; unset means erasure logs `analytics_unconfigured` and the sweep skips
- `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`: supplied by Vercel, optional in the schema, the `enabled` predicate and the release tag
- Dashboard prerequisites before the thread can be proven: a Sentry project (Next.js platform) with its region chosen and the new issue email rule on `environment:production`; a PostHog project in the EU cloud with a personal API key scoped to person deletion; Vercel's "automatically expose system environment variables" left on so the three `VERCEL_*` values exist

**Critical test scenarios**:
- Happy path: a deliberate throw in a preview Server Action arrives in Sentry with the original file and line, tagged `org_id` and `user.id`, and the same session's `issueInvoice` produces one `invoice.issued` event in PostHog with `is_first: true`, verifies **AC-1**, **AC-3**, **AC-4**, **AC-10**, **AC-11**
- Failure case: the fake sink throws on every call and `issueInvoice` still returns `{ ok: true }` with one `analytics.failed` line; a handler that throws after `track` was declared produces no event, verifies **AC-10**, **AC-21**
- Failure case: `applySubscriptionState` run twice with the same `active` subscription returns `started` then `none`, so the webhook retry and the nightly reconcile cannot double count, verifies **AC-11**
- Privacy: `scrubEvent` strips headers, cookies, body, query and `user.email` and keeps `user.id` and `org_id`; the catalogue test finds no forbidden key; a portal event carries no person id, verifies **AC-4**, **AC-9**, **AC-12**
- Consent: a fresh visitor sees the banner, `Decline` hides it and no PostHog cookie exists, `Accept` hides it and the cookie appears; a `/portal` page has neither banner nor script, verifies **AC-14**, **AC-17**, **AC-18**
- Auth/permission: `setCookieConsent` works signed out, and a portal contact session never produces a person profile or an identified page view, verifies **AC-12**, **AC-17**
- Isolation: the unit and browser suites run with no provider variables and no request leaves for `/ingest` or `sentry.io`, verifies **AC-2**, **AC-22**

## Build plan

Tracer Bullet: the first two tasks push one real error and one real funnel event all the way to their dashboards from a preview deploy, through every layer they will ever touch (config, env, the wrapper, `after()`, the provider). Everything after thickens what that thread proved. No migration anywhere: the data model is provider side.

1. [x] **Sentry thread.** Install `@sentry/nextjs`; add `src/instrumentation.ts`, `src/instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`; wrap `next.config.ts` with `withSentryConfig` (Turbopack, so no webpack tree shaking options); declare the Sentry and Vercel variables as optional in `src/lib/env.ts` and `.env.example`; write `isSentryConfigured()` and the `enabled` predicate with its five case test; prove it with one deliberate throw on a preview deploy that lands in Sentry with a readable stack trace, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-23** _(built by /develop on 2026-09-18; the preview deploy proof is step 1 of `verify.md`)_
2. [x] **Analytics thread.** Create `src/analytics/` with `client.ts` (`createAnalytics({ sink })`, the `posthog-node` sink, the no op sink, `flush`), `events.ts` holding only `agency.created` and `subscription.started` for now, the `Properties` type and the catalogue test; add the `track` slot to `withTenantAction` with the fire and no fire tests; declare `createAgency`'s event; extend `applySubscriptionState` with `subscriptionTransition` and its test and fire from the webhook after commit; declare the PostHog variables; prove it with one real `agency.created` and one real `subscription.started` (Stripe test clock) visible in PostHog EU, satisfies **AC-9**, **AC-10**, **AC-11** (spine part), **AC-21**, **AC-22**, **AC-23** _(built; the PostHog proof is step 2 of `verify.md`)_
3. [x] **Sentry privacy, context and quota.** `src/observability/sentry-scrub.ts` with its test wired as `beforeSend` and `beforeSendTransaction` in all three configs; `setUser` and `setTag("org_id")` in `resolveStaffContext` and `resolveContactContext`; `tracesSampler` and the replay integration with the masked, error only settings, lazily loaded, satisfies **AC-4**, **AC-5**
4. [x] **Promoted signals and error boundaries.** `captureMessage` beside the `access.invariant` and `tenant.escape_hatch` log lines, `captureMessage` for a `failed` sweep report in the runner, `captureException` before the rethrow in both webhook routes with the explicit `org_id` tag, each with a fingerprint; the `useReportedError` hook, the `reference` prop and its line in `ErrorState`, the same by hand in `global-error.tsx`; axe in both themes, satisfies **AC-6**, **AC-7**
5. [x] **The full server catalogue.** The remaining events in `events.ts`; `track` slots on the listed actions; `onboarding.started` from the `/onboarding` page and `team_member.joined` from the membership insert paths (webhook and reconcile share them); `invoice.issued` with the `is_first` count; the PDF route and the portal pages and download route with `$process_person_profile: false`; `trial_end` added to `retrievedSubscription`; `identify` and `groupIdentify` at the listed points with `team_size`; `subscription_status` stamped on the three billing events; the portal properties test, satisfies **AC-11**, **AC-12**, **AC-13**
6. [x] **Browser page views and the proxy.** `AnalyticsProvider` mounted from the root layout outside `/portal`, memory persistence, manual `$pageview` with the reduced URL, `identify` from `useAuth()` inside `IdentifiedAnalytics`; the two `rewrites` and `skipTrailingSlashRedirect`; a browser test that a `/portal` page loads no PostHog script and a signed in agency page sends one `$pageview` through `/ingest` (asserted against a stub, with no provider variables in CI), satisfies **AC-14**, **AC-15**, **AC-16**
7. [x] **Consent and the privacy page.** `readConsent` with its test, `setCookieConsent` with its Zod parse, the banner component and its placement in the root layout, the persistence switch in `AnalyticsProvider`, the `Cookie settings` control on `/privacy` and in the user menu, `/privacy` itself and its links from the banner, sign in, sign up and the user menu; axe in both themes; the Playwright consent walk, satisfies **AC-17**, **AC-18**, **AC-19**
8. [x] **Erasure.** `deletePerson` in the analytics client, the call from the reconcile's scrubbed path inside `after()`, the `analytics_erasure` sweep in `SWEEP_ORDER` with its skip reason and counts, and the sweep's unit test with the fake sink, satisfies **AC-20**
9. [x] **The verify walk.** `verify.md`: the Sentry region and alert rule, one production error arriving by email, the funnel from a fresh sign up through a Stripe test clock conversion read back in PostHog, the banner in both themes, a portal page with no script, satisfies **AC-8** and re proves **AC-3**, **AC-18**

## Consequences

**Positive**:
- The funnel is honest: every spine event fires where the state changes, inside or right after the transaction, so a blocked script, a double submit or a webhook retry cannot inflate it.
- One rule covers both providers (ids, enums, dates and counts only), enforced by a type and a test rather than by memory, so a future event cannot quietly leak an email.
- Your customers' clients are outside the whole system: no script, no cookie, no banner, no profile. That is a sentence you can say to an agency that asks.
- Errors arrive with the agency and the runtime, with a readable stack trace, and the boundaries hand people a reference they can quote.
- The cookie consent debt is paid in its smallest honest form, and `/privacy` gives every later feature a place to be truthful.
- Nothing new is stored locally, so the tenant layer, the migrations, the retention sweep and the backups are untouched.

**Negative / tradeoffs**:
- Nine more environment variables across three dashboards, and two providers that can each be down or out of quota independently.
- The Sentry student plan ends after one year and stops collecting past its quota rather than billing; you declined the quota alert, so the first sign will be an empty dashboard. Revisit when the plan runs out (PostHog's error tracking is the natural fallback).
- PostHog group analytics (querying by agency properties) may be a paid add on on the free plan; `subscription_status` is stamped on the billing events so the conversion funnel works without it, but agency level breakdowns of other events may not. Verify on the plan page when the project is created.
- Cookieless page views before consent cannot be stitched across visits for anonymous visitors, and a person who declines is never stitched. Signed in staff are identified either way, which is the case that matters.
- Browser errors from people running ad blockers are lost, by choice (no Sentry tunnel). Server side errors, which are the ones that matter, are unaffected.
- No server side consent ledger: the cookie is the only record of a choice. For an analytics cookie at this scale that is proportionate; a ledger becomes worth it only if a regulator or an enterprise customer asks.
- Two named exemptions to the `env()` rule: `next.config.ts` reads the Sentry build variables and the browser client reads the two `NEXT_PUBLIC_` keys directly, for the same reason `isClerkConfigured` already does.
- `/privacy` is a plain notice, not a lawyer's policy, and terms of service stay deferred.

**Neutral**:
- `withTenantAction` gains its second declarative slot; the pattern is now established and a third (audit events, spec 0015's deferred item) would follow it.
- `applySubscriptionState` returns a transition alongside its outcome; the webhook and the reconcile both read it. The Stripe reconcile can therefore be the one that records a conversion if the webhook was missed, which is the point.
- The daily cron gains a seventh sweep. Spec 0017's per sweep isolation means an erasure failure cannot stop the prune.
- `IdentityProvider` is unchanged; the browser side identity comes from Clerk's own hook behind the same `clerkLive` gate the shell uses.
- The first funnel step is a page reached, not an account created. Clerk's own dashboard still counts sign ups, so the drop between "signed up" and "reached onboarding" is readable there if it is ever needed.

## Follow-up

- [ ] Agent Skill and MCP discovery for PostHog was deferred at design time (`Not now, later`). A PostHog Agent Skill would carry the current `posthog-js` and `posthog-node` option names (cookieless persistence, `$process_person_profile`, the person deletion endpoint) so the build does not guess them; PostHog also publishes an MCP server that would let the agent read the live project (events, insights) while verifying. Add either when you want them.
- [ ] `gdpr-data-handling` is installed and shaped the consent and erasure design but is not yet in root `AGENTS.md` `## Agent skills`; it is area wide (consent, erasure) rather than project wide, so a one line pointer at root naming when it applies is enough.
- [ ] `vercel-observability` (`vercel-labs/agent-skills`) is installed and named in spec 0001 but not in `AGENTS.md`; add it to `## Agent skills` if the runtime log side (Vercel's own log drains and the `VERCEL_*` variables) is ever designed further.
- [ ] Accept the data processing agreements in the Sentry and PostHog dashboards and record the Sentry region in `verify.md`; both are operator steps the build cannot do.
- [ ] Declined at design time and worth reconsidering later: a Sentry quota threshold email (the student plan stops silently) and a Sentry Cron monitor on `/api/cron/daily`.
- [ ] A lint rule in the shape of `clienthq/no-raw-db-import` restricting `posthog-*` and `@sentry/nextjs` imports to the files named in invariant 1; review enforces it until then.
- [ ] The scope's deferred "Legal pages & cookie consent" item is now half settled: consent and `/privacy` ship here, terms of service and a lawyer reviewed policy remain deferred. `/sync` should split that bullet.
- [ ] Verify the PostHog free plan's group analytics status and the exact person deletion endpoint on the day the project is created; both are named here from knowledge as of mid 2026.
- [ ] When the Sentry student plan ends, decide between a paid Sentry plan and PostHog's error tracking (one dashboard, one DPA).
