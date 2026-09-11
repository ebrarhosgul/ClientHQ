# Verify: subscription access gate · spec 0008 · updated 2026-09-11

_Steps derived from spec 0008 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

The manual steps need a signed in agency admin and a way to set the `subscriptions` row by hand (`pnpm db:studio`, or a SQL update on the row's `status` and `past_due_since`). `pnpm db:seed` gives you two agencies: Studio North on `active`, and Harbor Lane on `past_due` since an hour before the seed ran, so the grace window is open on the day you seed and closes on its own a week later. To sign in as either you need a Clerk organization whose id matches the seeded `clerk_org_id`, or point your own organization's row at the state you want.

## UI / manual

- [ ] Sign in as a brand new agency (no `subscriptions` row) and open `/dashboard` → redirected to `/billing`, which shows the "No subscription" card and a Subscribe button and no locked notice → AC-1, AC-4, AC-10
- [ ] From that `/billing`, subscribe in Stripe test mode, wait for the webhook, then open `/dashboard` → the page renders with no banner, and `/clients` renders too → AC-1, AC-4
- [ ] Set the row to `status = past_due`, `past_due_since = now() - interval '1 hour'`, reload `/clients` → the list renders under one banner headed "Your last payment failed, so changes are paused", naming a date and time ending in "(UTC)" seven days after `past_due_since` → AC-2, AC-5
- [ ] As an admin in that state, press "Update your card" in the banner → Stripe's Billing Portal opens (the button is the existing `openBillingPortal` action) → AC-5, AC-6
- [ ] As a member in that state → the banner has no button, carries "Only an admin of this agency can update the card.", and its "See billing" link lands on `/billing` → AC-5
- [ ] Still in grace, open `/clients/new`, fill in a name and submit → the alert says the subscription needs attention, with a "Go to billing" link, and the client is not created (the list is unchanged after a reload) → AC-6, AC-7, AC-8
- [ ] Still in grace, on a client's detail page press Archive and confirm → the dialog shows the same refusal with the link, and the client stays active → AC-6, AC-7
- [ ] Set `past_due_since = now() - interval '7 days 1 second'` and reload `/clients`, running no job → redirected to `/billing` → AC-2, AC-4
- [ ] On that `/billing` as an admin → a notice headed "Access is paused" opens the page, says nothing has been deleted, and says subscribing again or updating the card restores access; the status card below still reads "Payment failed" → AC-10
- [ ] The same as a member → the notice says only an admin of this agency can subscribe again or update the card → AC-10
- [ ] While locked, open `/settings` → it renders (no redirect), and `/billing` renders, so the redirect never loops → AC-4
- [ ] While locked, press "Manage billing" on `/billing` as an admin → the portal opens: the exempt action works at every level → AC-6
- [ ] Set the row back to `active` (or let a test mode payment succeed so the webhook clears `past_due_since`) and reload `/dashboard` → no banner, and a client can be created again → AC-1, AC-2
- [ ] Set `status = 'canceled'` → every gated page redirects to `/billing`, which shows the locked notice and both Subscribe and Manage billing → AC-1, AC-4, AC-10
- [ ] Set `status = 'something_new'` → every gated page redirects to `/billing`, the notice shows, and the status card says Stripe reports the subscription as "something_new" → AC-1
- [ ] Set `status = 'past_due'` with `past_due_since = null` → locked (redirect to `/billing`), and the server log carries one `access.invariant` line with the organization id per request → AC-3
- [ ] Set `cancel_at_period_end = true` on an `active` row → nothing changes: full access, no banner → AC-1
- [ ] Stop the database (or point `DATABASE_URL` at a closed port) and open `/dashboard` → the "Something went wrong" error state renders inside the shell with Try again and Open billing, never a blank page with full access → AC-12
- [ ] With `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` blank, open `/dashboard` and `/clients` → both render as they did before this feature, with no banner → AC-13
- [ ] Open `/design`, find "Subscription access" → both banner variants and both notice variants render in the light and the dark palette; Tab reaches "Update your card" and "See billing" with the product's focus ring; a screen reader announces each as a region with its heading as the name → AC-14
- [ ] With a screen reader, land on `/clients` in grace → the banner is announced as a region named by its first line, and its text does not depend on the tint → AC-14

## Commands

- [ ] `corepack pnpm vitest run src/access/level.test.ts` → passes: the full status table, the 7 day boundary in both directions, and the null `past_due_since` case → AC-1, AC-2, AC-3
- [ ] `corepack pnpm vitest run src/db/tenant/action.test.ts src/db/tenant/subscription.test.ts` → passes: refusal after the role guard and before parsing, no transaction opened, `subscription: "any"` skips the gate but not the role guard, a failed read rethrows → AC-6, AC-11, AC-12
- [ ] `corepack pnpm vitest run src/payments/fence.test.ts` → passes: `subscription: "any"` appears in exactly `start-checkout.ts` and `open-billing-portal.ts` → AC-6
- [ ] `corepack pnpm vitest run "src/app/(agency)/(gated)"` → passes: pass through with no Clerk key, redirect on `unsubscribed` and `locked`, banner on `grace`, and the route tree keeps `billing` and `settings` outside the group → AC-4, AC-5, AC-13
- [ ] `DIRECT_URL=<dev database> corepack pnpm vitest run src/access/gate.db.test.ts` → passes: real SQL through the scoped accessor, another agency's `active` row never leaks, every statement the gate emits is a `select` and the row is unchanged → AC-8, AC-9
- [ ] `corepack pnpm vitest run src/access/ui src/ui/patterns/action-error.test.tsx "src/app/(agency)/error.test.tsx"` → passes: axe on both variants in both themes, the link on `subscription_inactive` and on no other code → AC-7, AC-14
- [ ] `corepack pnpm typecheck` → passes; then temporarily remove the `subscription_inactive` line from `MESSAGES` in `src/ui/patterns/error-messages.ts` and run it again → fails, proving the union is exhaustive; put the line back → AC-7
- [ ] `corepack pnpm test:e2e` → passes, including axe on `/design` in both painted palettes and `/dashboard` with no Clerk key → AC-13, AC-14
- [ ] `grep -rn "stripe" src/access/` → nothing but comments: the gate imports neither `src/payments/stripe.ts` nor `src/payments/gateway.ts` → AC-8
- [ ] `corepack pnpm db:seed` (against a local or allowed host) → reports 2 organizations and 2 subscriptions; Harbor Lane's row is `past_due` with `past_due_since` an hour before the run → AC-2

## Value sourcing checks

One step per row of the spec's Value sourcing table, exercising the source and the edge that breaks if it is wrong.

- [ ] The Stripe status: change only `subscriptions.status` between `active` and `unpaid` and reload → the level follows the column, with no Stripe call in the server log → AC-1, AC-8
- [ ] When the failure started: set `past_due_since` to two different times an hour apart → the banner's date moves by exactly an hour, so the window is measured from the column and not from the reload → AC-2, AC-5
- [ ] The current time: with the same row, a request just before `past_due_since + 7 days` sees the banner and a request just after is redirected, with no write in between → AC-2
- [ ] The window length: `GRACE_WINDOW_DAYS` is `7` in `src/access/level.ts` and appears in no environment file or `env.ts` → AC-2
- [ ] Which statuses are known: `SUBSCRIPTION_STATUSES` in `src/payments/subscription-status.ts` lists Stripe's eight, and `billing-state.ts` imports it from there rather than defining its own → AC-1
- [ ] Which organization: sign in to agency A while agency B's row is `active` and A has none → A is unsubscribed; the level never comes from a URL or form value → AC-9
- [ ] Whether to show the portal button: with `memberships.role` set to `member` in the database but a Clerk admin session → the banner still shows the button, because the role comes from the session claim → AC-5
- [ ] "Changes are paused until …": the banner's time is `past_due_since + 7 days` rendered in UTC with "(UTC)" after it, and matches the `datetime` attribute on the `<time>` element → AC-5
- [ ] The Billing Portal from the banner: the request the button makes is the same `openBillingPortal` Server Action `/billing` uses → AC-5, AC-6
- [ ] Where to send a locked agency: the redirect target is the literal `/billing` from `src/ui/shell/navigation.ts`; renaming that path there fails `routes.test.ts` → AC-4
- [ ] The row the guard judges: refuse a write in grace, then set the row to `active` and retry the same form without reloading → it saves, because the guard reads fresh on every call → AC-6, AC-9
- [ ] The invariant break: `past_due` with null `past_due_since` logs exactly one `access.invariant` line per page request and one per refused action, each carrying `orgId` → AC-3
- [ ] Who can fix it (the notice): the notice's last sentence follows the session role, not `memberships.role` and not anything in the URL (`/billing?role=admin` changes nothing) → AC-10
- [ ] Whether to run the gate at all: blank the Clerk publishable key → the gated layout never calls `agencyAccess()` (no subscription query in the log) → AC-13
- [ ] The refusal message: the `subscription_inactive` sentence never contains a Stripe status name, for `past_due`, `unpaid`, `canceled` and `something_new` alike → AC-6
- [ ] That nothing was deleted: after every step above, `select count(*) from clients` (and projects, invoices) for the agency is unchanged → AC-8
- [ ] Whether `/billing` renders the notice: on `unsubscribed` there is no notice, only the "No subscription" card; on `locked` the notice is present → AC-10

## Acceptance-criteria coverage

- AC-1 · covered by the fresh agency, subscribe, canceled, unknown status and `cancel_at_period_end` steps; `level.test.ts`
- AC-2 · covered by the grace, lapse without a job and boundary steps; `level.test.ts`, `gate.db.test.ts`, the seed
- AC-3 · covered by the null `past_due_since` step and its log line; `level.test.ts`, `subscription.test.ts`, `gate.test.ts`, `gate.db.test.ts`
- AC-4 · covered by the redirect, `/settings` and no loop steps; `layout.test.tsx`, `routes.test.ts`, `billing/page.test.tsx`
- AC-5 · covered by the banner steps for admin and member, the UTC time and the portal button; `grace-banner.test.tsx`, `layout.test.tsx`
- AC-6 · covered by the refused create and archive, the exempt portal while locked, and the order of checks; `action.test.ts`, `subscription.test.ts`, `fence.test.ts`
- AC-7 · covered by the typecheck removal step and the "Go to billing" link; `action-error.test.tsx`, `errors.test.ts`
- AC-8 · covered by the unchanged counts and the `grep`; `gate.db.test.ts`, `gate.test.ts`, `subscription.test.ts`
- AC-9 · covered by the two agency step; `gate.db.test.ts`, `gate.test.ts`, `subscription.test.ts`
- AC-10 · covered by the locked notice steps for admin and member; `locked-notice.test.tsx`, `billing/page.test.tsx`
- AC-11 · covered by the refusal log lines; `subscription.test.ts`
- AC-12 · covered by the stopped database step; `error.test.tsx`, `layout.test.tsx`, `action.test.ts`, `subscription.test.ts`, `gate.test.ts`
- AC-13 · covered by the blank Clerk key step; `layout.test.tsx`, `pnpm test:e2e`
- AC-14 · covered by the `/design` and screen reader steps; axe in the component tests and `pnpm test:e2e`
