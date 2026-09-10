# Verify: subscription checkout & Stripe webhook · spec 0007 · updated 2026-09-11

_Steps derived from spec 0007 acceptance criteria and its Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

**Before any of the manual steps**, three environment variables have to exist, and only you can make them: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_ID`. `.env.example` lists the Stripe dashboard setup they come from, including the **14 day trial**, which lives on the Price and nowhere in this repository. Locally, run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and use the `whsec_...` it prints.

Everything under **Commands** already passes today and needs none of that.

## UI / manual

- [ ] Sign in as an agency **admin** whose organization has no subscription → `/billing` shows "No subscription", a Subscribe button, and **no** portal link → AC-1
- [ ] Click Subscribe → the browser lands on a page hosted by Stripe; no card field ever renders on our own domain → AC-2, and the PCI scope claim
- [ ] In the Stripe dashboard, open the Checkout Session just created → `client_reference_id` equals the internal `org_id`, and the subscription's `metadata.org_id` is the same value → AC-2
- [ ] Pay with `4242 4242 4242 4242` → back on `/billing`; after the webhook lands, exactly one `subscriptions` row exists for that organization with `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `status`, `current_period_end` and `cancel_at_period_end` all populated → AC-3
- [ ] Check that row's `current_period_end` against `subscription.items.data[0].current_period_end` in the Stripe dashboard → they match, and it is **not** null → AC-4
- [ ] `/billing` now says "Free trial" and names the date the trial ends, in UTC and labelled → AC-5
- [ ] Open browser devtools' network tab and reload `/billing` → no request to Stripe from the server render; the page is drawn from the local row alone → AC-17
- [ ] Click Manage billing → Stripe's Billing Portal opens, and its back link returns to `/billing` → AC-6
- [ ] Cancel in the portal → `cancel_at_period_end` becomes true locally and the page says "Your access ends on …" → AC-7
- [ ] Let the period end (or cancel immediately in the portal) → `status` becomes `canceled`, and `/billing` offers **both** Subscribe and Manage billing → AC-6, AC-7
- [ ] Subscribe again from that cancelled state → the Stripe customer id on the row is the **same** one as before, and the Stripe dashboard shows one customer for this agency, not two → AC-14
- [ ] Double click Subscribe as fast as you can → one Checkout Session is created, not two, and no second customer appears in Stripe → AC-18
- [ ] Sign in as an agency **member** → `/billing` shows the same status with no buttons and the "only an admin" sentence → AC-13
- [ ] Still as that member, call `startCheckout({})` and `openBillingPortal({})` directly from the browser console → both return `{ ok: false, error: { code: "forbidden" } }` → AC-13
- [ ] Walk `/billing` with a keyboard and a screen reader in each state you can reach (no subscription, trialing, active, past due, cancelled, and the error boundary) in both light and dark → no WCAG 2.2 AA violation, and the status is readable without relying on the chip's colour → AC-19

### Value sourcing, the edges that break quietly

- [ ] Set your machine's timezone to `Pacific/Auckland`, reload `/billing` with a `current_period_end` late in the UTC day → the date still reads the **UTC** day and says "(UTC)"; it does not shift a day → Value sourcing, `/billing` trial end or renewal date
- [ ] Change the agency's role claim in Clerk from admin to member without touching `memberships.role` → the buttons disappear on the next load, proving the page reads the session claim rather than the database mirror → Value sourcing, `/billing` whether to show any action
- [ ] Temporarily point `STRIPE_PRICE_ID` at a second Price → the new subscription's `stripe_price_id` matches it, read from the subscription **item** → Value sourcing, webhook `stripe_price_id`
- [ ] In `psql`, set the row's `past_due_since` to a value, then deliver another `past_due` event → the timestamp is unchanged, and it is a database `now()` rather than the app's clock → AC-12, Value sourcing, webhook `past_due_since`

## Commands

- [ ] `corepack pnpm vitest run src/payments/webhook.db.test.ts` → 19 pass against real PostgreSQL: replay, out of order delivery, the failed state change rolling the ledger back, two concurrent deliveries, the poison events, and `past_due_since` → AC-8, AC-9, AC-10, AC-12, AC-15, AC-16, AC-22, AC-23, AC-25, AC-26, AC-27
- [ ] `corepack pnpm vitest run src/payments/events.test.ts` → the item level `current_period_end` and `price.id` are parsed rather than assumed, and a pre Basil shaped payload throws instead of storing null → AC-4
- [ ] `corepack pnpm vitest run src/payments/billing-state.test.ts` → a cancelled agency is offered Checkout **and** the portal; an unknown status renders rather than crashing → AC-1, AC-5, AC-6
- [ ] `corepack pnpm vitest run src/payments/idempotency.test.ts` → the key covers the agency, the attached customer and a five minute bucket → AC-18
- [ ] `corepack pnpm vitest run src/payments/fence.test.ts` → `withSystemAccess` is imported by exactly the Stripe route and the tenant layer's own test → AC-20
- [ ] `corepack pnpm vitest run tools/eslint/tenant-isolation-config.test.mts` → neither ESLint exemption list grew → AC-20
- [ ] `corepack pnpm exec playwright test e2e/billing.spec.ts` → 5 pass: the no subscription state, no buttons for someone who cannot act, axe clean in light and dark, and the loading state announcing itself in words → AC-1, AC-13, AC-19
- [ ] `curl -X POST localhost:3000/api/webhooks/stripe -H 'stripe-signature: t=1,v1=nonsense' -d '{}'` → **400**, and no row appears in `processed_webhook_events` → AC-11
- [ ] `curl -X POST localhost:3000/api/webhooks/stripe -d '{}'` (no signature header at all) → **400** → AC-11
- [ ] With `stripe listen` running: `stripe trigger checkout.session.completed`, then resend that same event from the Stripe dashboard → the second delivery returns 200 and changes no row → AC-8
- [ ] Watch the server log during any failed delivery → exactly one JSON line carrying `event`, `outcome`, `eventId`, `eventType`, `reason` and `at`; the signature failure line names what it can and claims no event id → AC-21
- [ ] `corepack pnpm build` → `/billing` and `/api/webhooks/stripe` both appear as dynamic routes

## Acceptance-criteria coverage

- AC-1 · manual (empty state) + `billing-state.test.ts` + `e2e/billing.spec.ts`
- AC-2 · manual (Checkout Session fields in the Stripe dashboard)
- AC-3, AC-4 · manual (row after a test mode subscribe) + `events.test.ts` + `webhook.db.test.ts`
- AC-5 · manual (trial end wording) + `billing-state.test.ts`
- AC-6, AC-7 · manual (portal, cancel, resubscribe) + `billing-state.test.ts`
- AC-8, AC-9, AC-10 · `webhook.db.test.ts` + manual resend from the Stripe dashboard
- AC-11 · the two `curl` steps
- AC-12 · `webhook.db.test.ts` + the database clock step
- AC-13 · manual, both as a member and by calling each action directly + `e2e/billing.spec.ts`
- AC-14, AC-15, AC-18 · manual (one Stripe customer, double click) + `webhook.db.test.ts` + `idempotency.test.ts`
- AC-16, AC-22, AC-23, AC-25, AC-26, AC-27 · `webhook.db.test.ts`
- AC-17 · manual (no Stripe call on render)
- AC-19 · manual pass over every state + `e2e/billing.spec.ts` in both themes
- AC-20 · `fence.test.ts` + `tenant-isolation-config.test.mts`
- AC-21 · manual (read the log line on a failure)
- AC-24 · read `src/payments/webhook.ts`: `retrieveSubscription` is awaited before `db.transaction` opens. Not observable at runtime, so it is a code reading step, and `/check review` is the better place for it
