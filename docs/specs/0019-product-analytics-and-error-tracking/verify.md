# Verify: product analytics and error tracking · spec 0019 · updated 2026-09-18

_Steps derived from spec 0019 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

Two kinds of step. The **Commands** run on any machine with no provider account. The **preview and production walk** needs the dashboards: a Sentry project (Next.js platform) with its region chosen, a PostHog project in the EU cloud with a personal API key scoped to person deletion, the nine variables set in Vercel (the auth token on the build environment only), and Vercel's "automatically expose system environment variables" left on. Record what you find in the two blanks below so the next reader does not have to look.

- Sentry region: `________` (EU or US, chosen at project creation; the notice on `/privacy` says both are possible)
- Sentry alert rule: email on every new issue, filtered to `environment:production`: `[ ]` created

## Commands

- [ ] `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm format:check` → all three green → AC-9 (the plain `string` property is a compile error; see `src/analytics/properties.ts`)
- [ ] `corepack pnpm vitest run src/observability` → `sentryEnabled` passes all five cases (production, preview, development, test, unset), `scrubEvent` strips headers, cookies, body, query string and `user.email` and keeps `user.id` and `org_id`, `tracesSampler` returns 0 for `/api/cron` and `/api/webhooks` → AC-2, AC-4, AC-5
- [ ] `corepack pnpm vitest run src/analytics` → the catalogue test finds no forbidden key and no portal event with a person id, the client never throws on a failing sink and logs `analytics.failed` once per call, the default client is silent under `NODE_ENV=test`, `readConsent` reads a missing or malformed cookie as `undecided`, the provider initialises cookieless through `/ingest` and captures one `$pageview` per pathname with no query or hash, the banner is a named region with equal buttons and is absent under `/portal` → AC-9, AC-12, AC-14, AC-17, AC-18, AC-21, AC-22
- [ ] `corepack pnpm vitest run src/db/tenant/action-track.test.ts` → the `track` slot fires once after the commit and not on a parse failure, a role refusal, a subscription refusal or a thrown handler → AC-10
- [ ] `corepack pnpm vitest run src/payments/subscription-transition.test.ts` → `started` on every move into `active`, `none` when unchanged, `changed` otherwise → AC-11
- [ ] `corepack pnpm vitest run src/cron/analytics-erasure.test.ts src/cron/daily.test.ts` → the sweep re issues `deletePerson`, counts `persons_deleted` and `persons_failed`, skips with `analytics_unconfigured`, and sits after `clerk_reconcile` and before `retention_prune` → AC-20
- [ ] `corepack pnpm vitest run src/ui/patterns` → `ErrorState` shows `Reference: <id>` only when given one, axe clean in both themes → AC-7
- [ ] `corepack pnpm test:e2e -- e2e/analytics-consent.spec.ts` → no request leaves for `/ingest`, `sentry.io` or `posthog.com` from `/`, `/dashboard`, `/privacy` or `/portal`; Decline and Accept hide the banner in place and write `clienthq_consent` (`HttpOnly`, `SameSite=Lax`, `Path=/`, one year); Cookie settings on `/privacy` brings it back; `/portal` has no banner, no PostHog chunk and no `ph_` cookie; `/privacy` is 200, names both collectors, the identifiers and the cookie, is linked from `/sign-in` and `/sign-up`, and passes axe in both themes → AC-14, AC-17, AC-18, AC-19, AC-22
- [ ] `SENTRY_AUTH_TOKEN= corepack pnpm build` → completes with no upload step and no failure, and `ls .next/static/chunks/*.map` finds nothing → AC-3

## Preview and production walk (manual)

_Sentry_

- [ ] On a preview deploy, throw once from each of: a Server Component, a Server Action, a route handler, `src/proxy.ts` and a client component (a temporary `throw new Error("verify 0019")` each, removed afterwards) → five issues in Sentry, one event each, tagged `runtime` `node`, `node`, `node`, `edge`, `browser` and `environment: preview` with `release` equal to the commit SHA → AC-1, AC-2
- [ ] Open the Server Action event → the stack trace shows the original `.ts` file and line, not a minified bundle; the build log shows the source map upload; `ls .next/static/chunks/*.map` on the built output finds nothing → AC-3
- [ ] On the same event → no `request.headers`, `request.cookies`, `request.data` or `request.query_string`; `user` holds only `id`; the `org_id` tag is the agency's local id; no console breadcrumb contains an `@` → AC-4
- [ ] Sign in as a client contact, throw once from a portal page → the event carries `org_id` and `user.id` (the Clerk user id) and nothing naming the client or contact row → AC-4 (Value sourcing: the contact context stamps the scope)
- [ ] In Sentry's Performance view after a day → transactions from `/api/cron/daily` and `/api/webhooks/*` are absent; other routes sample at about a tenth → AC-5
- [ ] Trigger the client component error again → the Replays tab holds one replay for it with every text, input and image masked; a session with no error produces no replay → AC-5
- [ ] Throw from a segment page → the boundary shows `Reference: <event id>` under the message, focus lands on the message region, the id matches the Sentry event; on a local `pnpm dev` the same boundary shows no reference at all → AC-7
- [ ] With the deployed database, put a `subscriptions` row into `past_due` with `past_due_since` null, load `/dashboard` → one `access.invariant` issue tagged `org_id`, and a second load groups into the same issue → AC-6
- [ ] Send a Stripe test webhook whose subscription id does not exist at Stripe with a deliberately broken payload shape (or point the deploy at a bad `STRIPE_WEBHOOK_SECRET` and fix it afterwards) → the 500 path produces one `stripe_webhook` issue; the retry groups into it → AC-6
- [ ] Make the cron route fail one sweep (an unreachable `CLERK_SECRET_KEY` on a preview) → one `cron.sweep_failed: clerk_reconcile` issue with the sweep name and its error text, and no `org_id` tag → AC-6
- [ ] Deliberately throw once from a Server Action on **production** → an email arrives from Sentry for the new issue; the same throw on preview sends no email → AC-8
- [ ] On a laptop, `pnpm dev` with `NEXT_PUBLIC_SENTRY_DSN` set and the browser's network tab open → no request to `sentry.io` on any page or error → AC-2

_PostHog_

- [ ] Sign up a fresh person on the preview deploy and land on `/onboarding` → `onboarding.started` in PostHog for that Clerk user id; reload `/onboarding` twice → the funnel still counts one person at that step (Value sourcing: the page render, never a user row) → AC-11
- [ ] Create the agency → `agency.created` with `org_id`; the person carries `role: admin` and `created_at` equal to `users.created_at`; the `agency` group carries `subscription_status: none`, `team_size: 1`, `created_at` equal to `organizations.created_at`, no `trial_ends_at`, no `subscribed_at` → AC-11, AC-13
- [ ] Create a client, a project, upload and confirm a deliverable, make it visible, invite a contact, invite a team member → one event each (`client.created`, `project.created`, `deliverable.uploaded`, `deliverable.shared`, `contact.invited`, `team_member.invited`) with only ids, the role, and `org_id`; make the deliverable hidden again → no second `deliverable.shared`; confirm the same upload twice → one `deliverable.uploaded` → AC-12
- [ ] Issue the agency's first invoice → `invoice.issued` with `is_first: true`; issue a second → `is_first: false` (Value sourcing: the count inside the issuing transaction) → AC-11
- [ ] Mark one paid, void the other, download a PDF as staff → `invoice.paid`, `invoice.voided`, `invoice.pdf_downloaded` → AC-12
- [ ] Press Subscribe → `checkout.started` with `subscription_status: none`; complete Checkout with a Stripe test clock → `subscription.started` on `distinct_id` `org:<org_id>` with `subscribed_at` and `subscription_status: trialing` or `active`, exactly one even after replaying the webhook from the Stripe dashboard; the group now carries `trial_ends_at` (from Stripe, not a column) and `subscribed_at` → AC-11, AC-13
- [ ] Advance the test clock past the trial → `subscription.changed` with `status: active`; advance to a failed payment → another with `status: past_due`; disable the webhook endpoint, advance again, run `/api/cron/daily` → the nightly reconcile records the change once → AC-11
- [ ] Accept the team invitation as a second person → `team_member.joined` for the joiner with their role, and the group's `team_size` is 2; change their role → the person's `role` updates and no new event; remove them → `team_size` is 1 → AC-12, AC-13
- [ ] Accept the contact invitation and open the portal, an invoice and download a file → `contact.accepted`, `portal.viewed` (with `path`), `portal.invoice_viewed`, `portal.file_downloaded` all on `distinct_id` `client:<client_id>`, carrying `org_id` and `client_id`, none carrying `user_id` or `contact_id`, and PostHog's Persons list shows no person for the contact → AC-12
- [ ] Browse `/dashboard` and `/invoices/1?tab=events#top` signed in → two `$pageview` events through `/ingest` with `$current_url` equal to origin plus pathname, no query string, no hash, on the staff person's Clerk user id; the network tab shows only `/ingest/...` requests, none to `posthog.com` → AC-14, AC-15, AC-16
- [ ] Before accepting the cookie → no `ph_` cookie exists; press Accept → a `ph_` cookie appears and `clienthq_consent=accepted` is set; press Cookie settings in the user menu → the banner returns → AC-18
- [ ] Open any `/portal` page as the contact → no banner, no request to `/ingest`, no chunk named `posthog`, no `ph_` cookie → AC-14
- [ ] Delete the second person's Clerk account → after the webhook, PostHog no longer lists them; then set `POSTHOG_PERSONAL_API_KEY` blank on the preview, delete another test person, run `/api/cron/daily` → the `analytics_erasure` sweep reports `skipped` with `analytics_unconfigured`; restore the key, run again → `persons_deleted: 1` → AC-20
- [ ] Set `NEXT_PUBLIC_POSTHOG_KEY` blank on a preview → every page and action works unchanged, the runtime log shows one `observability.unconfigured` line naming the key, and no `/ingest` request is made → AC-21

_Copy and accessibility_

- [ ] `/privacy` in both themes with a screen reader → one `h1`, a heading per section in order, the cookie name read aloud, the Cookie settings button announced as a button → AC-19
- [ ] The banner with a keyboard → reached after the page content, Accept and Decline both reachable, Escape does nothing, focus is never trapped; in both themes the banner never covers the skip link target or a toast → AC-18

## Acceptance-criteria coverage

- AC-1 · five runtime throws on preview · AC-2 · the `sentryEnabled` test and the laptop network tab · AC-3 · the token free build and the stack trace on preview · AC-4 · the `scrubEvent` test and the event inspection · AC-5 · the sampler test, the Performance view and the Replays tab · AC-6 · the invariant, webhook and sweep issues · AC-7 · the pattern test and the boundary reference · AC-8 · the production email · AC-9 · typecheck and the catalogue test · AC-10 · the track slot test · AC-11 · the transition test and the funnel walk · AC-12 · the catalogue test and the event walk · AC-13 · the person and group properties in the walk · AC-14 · the provider test, the browser spec and the portal walk · AC-15 · the provider test and the signed in page views · AC-16 · the `/ingest` requests · AC-17 · the `readConsent` test and the cookie attributes in the browser spec · AC-18 · the banner test, the browser spec and the keyboard pass · AC-19 · the browser spec and the screen reader pass · AC-20 · the sweep test and the erasure walk · AC-21 · the client test and the blank key walk · AC-22 · the browser spec's provider isolation · AC-23 · `src/lib/env.ts` and `.env.example` name all eleven variables
