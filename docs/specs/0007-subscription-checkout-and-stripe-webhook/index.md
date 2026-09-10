# 0007. Subscription checkout and Stripe webhook

**Date**: 2026-09-10
**Status**: In Progress

## Summary

This settles how an agency starts paying you and how the app learns about it. The agency opens a billing page, clicks subscribe, and is sent to a payment page Stripe hosts, so card details never touch this app. Stripe then tells the app what happened by calling a webhook (a URL Stripe posts events to), and that webhook writes one local `subscriptions` row per agency, which every later screen reads instead of asking Stripe. The webhook is written by hand rather than delegated, because duplicate events, events that arrive in the wrong order, and events that arrive while a deploy is happening are the exact failure modes this feature exists to survive.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As an agency admin, I want to subscribe with a card so that my agency can use the product beyond the trial.
- As an agency admin, I want a 14 day trial before the first charge so that I can load real clients in before committing.
- As an agency admin, I want to change my card, see my payment history, and cancel without emailing anyone, so that billing is self serve.
- As an agency member, I want to see whether the agency is paid up without being able to change it, so that I know the state without holding the keys.
- As the operator of this app, I want subscription state mirrored locally and correct, so that the access gate in feature 9 has something trustworthy to read.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):

- **AC-1**: An agency admin whose organization has no `subscriptions` row sees `/billing` offering Checkout, not the Billing Portal.
- **AC-2**: Starting Checkout creates a Stripe Checkout Session in `subscription` mode carrying `client_reference_id` set to the internal `org_id` and the same `org_id` in `subscription_data.metadata`, and redirects the browser to the session URL.
- **AC-3**: Completing Checkout results in exactly one `subscriptions` row for that organization, with `stripe_customer_id`, `stripe_subscription_id`, `stripe_price_id`, `status`, `current_period_end` and `cancel_at_period_end` all populated from what Stripe reports, not from what the browser claimed.
- **AC-4**: `current_period_end` is read from the subscription item (`subscription.items.data[0].current_period_end`), not from a top level field on the subscription, and holds a real timestamp after a successful subscribe.
- **AC-5**: A newly subscribed agency has status `trialing`, and `/billing` states the date the trial ends.
- **AC-6**: `/billing` chooses its action from **status**, not from the presence of a customer: Checkout when there is no live subscription (no row, or status in `canceled`, `incomplete_expired`, `unpaid`), the Billing Portal whenever `stripe_customer_id` exists. An agency that has cancelled therefore sees Checkout to resubscribe **and** a Portal link for its payment history, and the Portal returns to `/billing`.
- **AC-7**: Cancelling through the Billing Portal is reflected locally: `cancel_at_period_end` becomes true, and `status` becomes `canceled` once the period ends.
- **AC-8**: Delivering the same Stripe event id twice changes no row the second time and returns 200.
- **AC-9**: Two subscription events delivered in the wrong order leave the row holding the state Stripe currently reports, because every handler re reads state with `subscriptions.retrieve` instead of trusting the event payload.
- **AC-10**: When applying a state change fails, the ledger insert and the state change both roll back, the route returns 500, and a later redelivery of that same event is processed rather than skipped as a duplicate.
- **AC-11**: A request whose Stripe signature does not verify returns 400 and writes nothing, including no ledger row.
- **AC-12**: `past_due_since` is set only when it is currently null, and is cleared whenever status is anything other than `past_due`.
- **AC-13**: Only an organization admin can start Checkout or open the Billing Portal. A member loads `/billing` read only with no action buttons, and calling either Server Action as a member is refused with `forbidden`.
- **AC-14**: An agency that cancelled and subscribes again reuses its stored `stripe_customer_id` rather than creating a second Stripe customer.
- **AC-15**: A `checkout.session.completed` for an organization that already has a `subscriptions` row updates that row rather than failing on the unique `org_id` constraint.
- **AC-16**: A webhook whose organization row has `deleted_at` set still writes the mirror row and returns 200.
- **AC-17**: Rendering `/billing` performs no Stripe API call; it reads the local mirror through the tenant scoping layer.
- **AC-18**: Submitting the Subscribe action twice in quick succession creates one Checkout Session, not two, and never a second Stripe customer.
- **AC-19**: `/billing` meets WCAG 2.2 AA in every state it can render: no subscription, trialing, active, past due, cancelled, and its error state.
- **AC-20**: `withSystemAccess` is imported only by `src/app/api/webhooks/stripe/route.ts`, and neither ESLint exemption list grows.
- **AC-21**: A webhook failure logs the event id, event type and error in one structured line before the 500 is returned. A signature failure logs too, naming what it can (there is no trusted event id on that path).
- **AC-22**: A `customer.subscription.*` event that arrives **before** any row exists for its customer still lands: the handler falls back to `org_id` from the retrieved subscription's `metadata` and upserts, rather than silently returning 200 and losing the transition.
- **AC-23**: Duplicate detection does not abort the transaction it protects: the ledger insert uses conflict-do-nothing and the handler returns 200 early on a no-op insert, so the duplicate path is a clean commit rather than a poisoned transaction.
- **AC-24**: `subscriptions.retrieve` is called **before** the database transaction opens, never inside it.
- **AC-25**: Concurrent deliveries for the same organization cannot commit inverted: the handler locks the `subscriptions` row for update inside the transaction before applying state.
- **AC-26**: A structurally unresolvable event (no usable `org_id`, or an `org_id` naming no organization) is logged and answered **200**, not 500, so a poison event cannot make Stripe retry until it disables the endpoint. Only transient failures return 500.
- **AC-27**: A `checkout.session.completed` naming a `stripe_customer_id` different from the one already stored for that organization does not overwrite the stored one silently: it is logged and refused as a conflict.

## Decision

**Chosen option**: Option 2: Hosted Checkout and Billing Portal, with a hand rolled webhook mirroring into one local row.

The agency subscribes through Stripe hosted Checkout, manages everything afterward in Stripe's Billing Portal, and a single verified webhook route is the only writer of the `subscriptions` table, re reading authoritative state from Stripe on every event rather than trusting the payload it arrived in.

**Implementation skills**: `stripe-best-practices` (`stripe/ai`, `.agents/skills/stripe-best-practices/`) · `stripe-integration` (`stripe/ai`, `.agents/skills/stripe-integration/`) · `upgrade-stripe` (`stripe/ai`, `.agents/skills/upgrade-stripe/`) · `stripe-docs` (`stripe/ai`, `.agents/skills/stripe-docs/`) · `nextjs-app-router-patterns` (`.agents/skills/nextjs-app-router-patterns/`) · `zod` (`.agents/skills/zod/`) · `error-handling-patterns` (`.agents/skills/error-handling-patterns/`) · `accessibility-compliance` (`.agents/skills/accessibility-compliance/`) · `drizzle` (`.agents/skills/drizzle/`) · `shadcn` (`.agents/skills/shadcn/`) · `vitest` (`.agents/skills/vitest/`) · `pci-compliance` (`.agents/skills/pci-compliance/`)

## Feature design

**Data model sketch**:

This feature adds no migration. Both tables already exist from [spec 0002](../0002-data-model-and-migrations/index.md); this is the code that finally fills them.

| Table | Key fields | Constraints and notes |
|---|---|---|
| `subscriptions` | `id`, `org_id` (uuid, not null, **unique**, cascade), `stripe_customer_id` (text, not null, unique), `stripe_subscription_id` (text, nullable, unique), `stripe_price_id` (text, nullable), `status` (text, not null), `current_period_end` (timestamptz, nullable), `cancel_at_period_end` (boolean, not null, default false), `past_due_since` (timestamptz, nullable), timestamps | One row per organization. Written **only** by the webhook route. `status` deliberately carries no CHECK constraint, so a Stripe status nobody has seen yet is recorded rather than rejected |
| `processed_webhook_events` | `id`, `source` (`stripe` or `clerk`), `event_id` (text, not null), `event_type` (text, not null), `processed_at` (timestamptz, not null) | Unique on (`source`, `event_id`). Not tenant scoped. No payload column, because events carry personal data and Stripe keeps the originals |

No `trial_end` column is added. While status is `trialing`, the subscription item's period end is the trial end, so `current_period_end` already carries the date `/billing` needs.

**State transitions**:

The local row does not own a state machine; it mirrors Stripe's. What this feature owns is the mapping of Stripe status onto `past_due_since`, and that is the only derived write:

```
any status other than past_due   →  past_due_since = null
past_due  and past_due_since is null  →  past_due_since = now()
past_due  and past_due_since is set   →  leave it untouched
```

Leaving an existing timestamp untouched is what stops a repeated `past_due` event from silently extending the grace window feature 9 will measure from it.

Interpreting those statuses as access levels (unsubscribed, full, grace, locked) is **not** in this feature. It belongs to feature 9, which reads the row this feature writes.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/billing` | GET (Server Component) | none, tenant from Clerk session | rendered status card, one action or none | signed in agency staff | redirect when signed out, error state when the read fails |
| `startCheckout()` Server Action | POST | none, `org_id` and role from tenant context | redirect to Stripe session URL | organization **admin** | `forbidden` for a member, `unavailable` when Stripe errors |
| `openBillingPortal()` Server Action | POST | none, `stripe_customer_id` from the local row | redirect to Portal session URL | organization **admin** | `forbidden` for a member, `not_found` when no customer exists yet |
| `/api/webhooks/stripe` | POST | raw request body, `stripe-signature` header | 200 handled, 200 duplicate, 200 poison, 400 bad signature, 500 retry me | none, signature verified | 400 unverifiable signature, 200 unresolvable event, 500 transient failure so Stripe retries |

**The webhook's processing order**, which is the part most easily got subtly wrong:

1. Read the **raw** body and verify the signature before parsing anything. A failure is 400 and writes nothing.
2. Resolve the organization. On `checkout.session.completed` that is `client_reference_id`; on a `customer.subscription.*` event it is the row found by `stripe_customer_id`, falling back to `metadata.org_id` on the retrieved subscription when no row exists yet. Unresolvable means **200 and a log**, never an endless 500.
3. Call `subscriptions.retrieve` **now, outside any transaction**. The pool is capped at one connection, so a Stripe round trip inside a transaction would serialize the whole application.
4. Open the transaction. Insert the ledger row with conflict-do-nothing; if nothing was inserted this event is a duplicate, so commit and return 200 without applying anything.
5. Lock the organization's `subscriptions` row for update, then apply the retrieved state. The lock is what stops two concurrent deliveries from each reading, then committing in the wrong order.
6. Commit. Any transient failure rolls the whole thing back, ledger row included, and returns 500 so Stripe retries.

The two Server Actions return the project's `Result` shape on failure and redirect on success. Neither takes an `org_id` argument: the tenant context is resolved from the Clerk session inside `withTenantAction()`, never from a form field.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `startCheckout` | `org_id` for `client_reference_id` and `subscription_data.metadata` | tenant context resolved from the Clerk session, per [spec 0003](../0003-tenant-scoping-data-access-layer/index.md) |
| `startCheckout` | the price to charge | `STRIPE_PRICE_ID` env var, read through `env()` |
| `startCheckout` | trial length | **not set in code**: it lives on the Stripe Price in the dashboard, and Checkout applies it automatically |
| `startCheckout` | `success_url` and `cancel_url` | `NEXT_PUBLIC_APP_URL` plus the literal path `/billing` |
| `startCheckout` | existing customer to reuse | `subscriptions.stripe_customer_id` when a row exists, otherwise omitted so Stripe creates one |
| `startCheckout` | idempotency key | derived: `org_id`, whether an existing customer is being attached, and the current time floored to a five minute bucket. All three matter: Stripe refuses a reused key whose parameters changed, and attaching a customer changes them |
| `openBillingPortal` | `customer` | `subscriptions.stripe_customer_id`, the action refuses when it is absent |
| `openBillingPortal` | `return_url` | `NEXT_PUBLIC_APP_URL` plus `/billing` |
| webhook | `org_id` to bind a new row to | `checkout.session.completed` event's `client_reference_id`, with `subscription_data.metadata.org_id` as the corroborating value |
| webhook | `org_id` on a later subscription event | looked up from `subscriptions` by `stripe_customer_id`; when no row exists yet, `metadata.org_id` on the retrieved subscription |
| webhook | `stripe_customer_id` | the retrieved subscription's `customer` (an id, or the id of the expanded object) |
| webhook | `stripe_subscription_id` | the retrieved subscription's `id`, never the session's, so one path produces it |
| webhook | `status`, `cancel_at_period_end` | the object returned by `subscriptions.retrieve`, never the event payload |
| webhook | `current_period_end` | `subscription.items.data[0].current_period_end` on that retrieved object |
| webhook | `stripe_price_id` | `subscription.items.data[0].price.id`, **also item level**. The column is nullable, so reading a top level path stores null silently rather than failing |
| webhook | the subscription id on an `invoice.*` event | the invoice's subscription reference for the pinned API version, confirmed at build time (see the note under Configuration required) |
| webhook | `past_due_since` | derived from the retrieved status plus the value already in the row. The timestamp itself is the **database** clock, not the application's, so the grace window feature 9 measures cannot drift with a serverless instance's clock |
| `/billing` | plan state wording | `subscriptions.status`, mapped to plain words for display only |
| `/billing` | trial end or renewal date | `subscriptions.current_period_end`, rendered in **UTC** with an explicit label, since the project has no per user timezone and inventing one here would be a silent guess |
| `/billing` | which action button to show | `subscriptions.status` decides Checkout versus nothing; `stripe_customer_id` decides whether a Portal link is also shown. Both, never customer id alone |
| `/billing` | whether to show any action at all | the Clerk session's organization role claim, never `memberships.role` |

**Key invariants**:

- The `subscriptions` table has exactly one writer: the webhook route. No Server Action, page, or script writes it.
- The ledger insert and the state change commit together or not at all. Committing the ledger first would mark an event handled while its effect was lost, and Stripe's retry would then be a silent no operation.
- Signature verification happens before the body is parsed, and a failure writes nothing at all.
- Event payloads are a signal that something changed, never the source of what it changed to.
- One organization maps to at most one Stripe customer, and a stored `stripe_customer_id` is never silently replaced by a different one.
- Card details never reach this app or its database. Only Stripe identifiers are stored.
- `/billing` never calls Stripe to render.
- A 500 means "this might work on retry". Anything that cannot succeed on retry answers 200 and logs, because Stripe disables an endpoint that keeps failing, and a disabled endpoint means a mirror that is silently frozen.
- Every value read off a subscription that lives on its item (`current_period_end`, `price.id`) is read from the item. There are two of them, and both fail quietly rather than loudly.

**Security model**:

| Who | May do |
|---|---|
| Organization `admin` (from the Clerk session claim) | Start Checkout, open the Billing Portal, read status |
| Organization `member` | Read status on `/billing`. Both Server Actions refuse with `forbidden` |
| Client contact (portal user) | No access. `/billing` is inside the agency route group |
| Stripe | Writes state, only through a request whose signature verifies |

Role comes from the Clerk session claim, not from `memberships.role`, which is a display mirror that can be stale until a Clerk webhook lands.

**Compliance scope**: PCI DSS applies, and this design deliberately keeps it at its smallest. Because both card entry surfaces are hosted by Stripe and the browser is redirected to them rather than embedding a payment form, the app qualifies for the lightest self assessment tier (SAQ A). Embedding Stripe Elements later would widen that scope, which is a reason not to. No cardholder data is stored, logged, or transmitted by this app.

**Configuration required**:

- `STRIPE_SECRET_KEY`: server side Stripe API key
- `STRIPE_WEBHOOK_SECRET`: verifies inbound Stripe webhook signatures
- `STRIPE_PRICE_ID`: the monthly subscription price, which also carries the 14 day trial
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: added per [spec 0001](../0001-stack-and-foundational-architecture/index.md)'s configuration list. Nothing reads it in this feature, since hosted Checkout redirects rather than mounting Stripe.js. It is present so a later embedded payment surface does not need an environment change across every deploy target
- `NEXT_PUBLIC_APP_URL`: already in `src/lib/env.ts`, used to build the Checkout and Portal return URLs

Every one of these goes into the Zod schema in `src/lib/env.ts` and is read through `env()`, never `process.env`.

**Stripe dashboard prerequisites** (these are changes only you can make, and coding cannot be finished without them):

1. Create the product and its monthly recurring Price, and set a **14 day trial** on that Price. The trial length lives here and nowhere in the repo.
2. Configure the Billing Portal: allow card updates, cancellation and invoice history, and set its return URL.
3. Register the webhook endpoint at `<your app URL>/api/webhooks/stripe`, subscribed to exactly the six events listed below, and copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Note the API version the account reports, so the code can pin it explicitly.

**Events consumed**: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.payment_succeeded`.

Only `checkout.session.completed` creates a row, because it is the only event carrying `client_reference_id`, which is the one thing that binds a Stripe customer to an agency. Every other event finds its row by `stripe_customer_id` and updates it.

**Two version sensitive details the build must confirm against the pinned API version.** Stripe's `2025-03-31.basil` release made both of these breaking changes, and getting either wrong fails quietly rather than loudly:

1. `current_period_start` and `current_period_end` were **removed from the Subscription object** and moved onto subscription items. Read the period end from `subscription.items.data[0].current_period_end`. Reading the old path yields `undefined`, which would store a null renewal date and silently break both the trial end display and the grace window feature 9 measures.
2. Invoicing objects changed how they name the subscription that generated them. The `invoice.*` handlers must resolve the subscription through the shape the pinned version documents, not the pre Basil top level field.

**Critical test scenarios**:

- Happy path: an admin with no subscription starts Checkout, completes it in Stripe test mode, and the resulting `checkout.session.completed` produces one row with a real `current_period_end` and status `trialing`, verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.
- Failure case: the same event id is delivered twice; the second delivery writes nothing and returns 200, verifies **AC-8**.
- Failure case: `customer.subscription.updated` events are applied in reverse order; the final row matches what `subscriptions.retrieve` reports rather than the older payload, verifies **AC-9**.
- Failure case: the state change throws part way through; no ledger row survives, the response is 500, and redelivering that event is then processed normally, verifies **AC-10**.
- Failure case: a request with a tampered signature returns 400 and leaves both tables untouched, verifies **AC-11**.
- Failure case: `past_due` arrives twice; `past_due_since` keeps its first value, then clears on a return to `active`, verifies **AC-12**.
- Failure case: a `checkout.session.completed` arrives for an organization that already has a row; the row is updated and no unique constraint error is raised, verifies **AC-15**.
- Failure case: a `customer.subscription.created` is delivered **before** its `checkout.session.completed`; the row is created from the retrieved subscription's `metadata.org_id` and the later session event updates rather than duplicates it, verifies **AC-22**.
- Failure case: a duplicate event does not abort its transaction; the handler commits cleanly and returns 200, proven by a following write in the same request succeeding, verifies **AC-23**.
- Failure case: two deliveries for one organization are processed concurrently; the row ends at the state of whichever retrieved last, never interleaved, verifies **AC-25**.
- Failure case: an event carrying no resolvable `org_id`, and one naming an organization that does not exist, both return 200 with a log rather than looping on 500, verifies **AC-26**.
- Failure case: a `checkout.session.completed` naming a different customer than the stored one is refused and logged rather than overwriting a paying customer, verifies **AC-27**.
- Auth/permission: a member loads `/billing` and sees status with no buttons, and calling `startCheckout()` directly as a member returns `forbidden`, verifies **AC-13**.
- Regression: a cancelled agency is offered Checkout to resubscribe, not only a Portal it cannot subscribe from, verifies **AC-6**, **AC-14**.

## Build plan

Ordered as a Tracer Bullet, per the project's build approach: task 3 puts one thin thread through every layer of this feature (env, Stripe client, action, hosted Checkout, webhook, database row, page) before any of it is thickened.

1. Add the four Stripe environment variables to the Zod schema in `src/lib/env.ts`, and record the dashboard prerequisites (product, Price with the 14 day trial, Portal configuration, webhook endpoint and secret, the API version the account reports) in the project's setup notes, satisfies **AC-2**, **AC-5**.
2. Install the `stripe` package and add `src/payments/stripe.ts`, a module that constructs one Stripe client with an **explicitly pinned** `apiVersion`, so a dashboard version change cannot reshape payloads under a deployed build. Confirm against the pinned version where the subscription item's `current_period_end` lives, satisfies **AC-4**.
3. **The thread, end to end**: `startCheckout()` in `src/payments/`, wrapped in `withTenantAction()` with an admin guard, creating a `subscription` mode Checkout Session that carries `client_reference_id` and `subscription_data.metadata.org_id` and returns to `/billing`; the `/api/webhooks/stripe` route implementing the full six step processing order above (verify, resolve, retrieve outside the transaction, conflict-do-nothing ledger insert, lock and apply, commit) through `withSystemAccess`; and a minimal `/billing` page showing either a Subscribe button or the raw status. Prove it by subscribing once in Stripe test mode with `stripe listen` forwarding, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-10**, **AC-11**, **AC-17**, **AC-20**, **AC-23**, **AC-24**, **AC-25**.
4. Handle the rest of the event set: `customer.subscription.created`, `updated` and `deleted`, plus `invoice.payment_failed` and `invoice.payment_succeeded`, each resolving its organization by `stripe_customer_id` with the `metadata.org_id` fallback for an event that outran its checkout session, and applying the object returned by `subscriptions.retrieve` rather than the event payload. Include the `past_due_since` rule on the database clock and the deleted organization case, satisfies **AC-7**, **AC-9**, **AC-12**, **AC-16**, **AC-22**.
5. Make replay, reordering and poison provable: unit tests feeding the handler a repeated event id, an out of order pair, concurrent deliveries for one organization, a state change that throws, an event with no resolvable organization, and one naming an organization that does not exist. Assert no partial write survives, and that only the transient failure answers 500, satisfies **AC-8**, **AC-9**, **AC-10**, **AC-23**, **AC-25**, **AC-26**.
6. Add `openBillingPortal()` with its admin guard and `return_url`, and give `/billing` its status driven action rule: Checkout when there is no live subscription, a Portal link whenever a customer exists, both together for an agency that cancelled, satisfies **AC-6**, **AC-7**.
7. Close the duplicate customer holes: reuse a stored `stripe_customer_id` when starting Checkout, send a Stripe idempotency key covering the organization, whether a customer is attached, and a five minute bucket, upsert on `org_id` conflict, and refuse a session naming a different customer than the stored one, satisfies **AC-14**, **AC-15**, **AC-18**, **AC-27**.
8. Thicken `/billing` into the real status card: plain wording per state, the trial end or renewal date, the member read only variant with actions hidden, and the loading, empty and error states built from the spec 0004 patterns, satisfies **AC-5**, **AC-13**, **AC-19**.
9. Add the structured log line (event id, event type, error) on every 500 path, on the 200 poison path, and on the 400 signature path (naming what it can, since there is no trusted event id there), shaped so feature 20 can forward it to Sentry without a rewrite, satisfies **AC-21**, **AC-26**.
10. Prove the fence held: assert neither ESLint exemption list grew, and that `withSystemAccess` is imported only by the Stripe webhook route, satisfies **AC-20**.
11. Run the accessibility pass on `/billing` in every state, both themes, keyboard and screen reader, satisfies **AC-19**.

## Consequences

**Positive**:
- Card data never touches this app, which keeps PCI scope at its lightest tier and removes a whole class of liability.
- Card updates, cancellation, invoice history and payment retries all come free with the Billing Portal, and none of it is code you own or maintain.
- Subscription state is one local row, read at page speed with no third party call in the request path, so a Stripe outage does not take the billing page down with it.
- The webhook is the one piece written by hand, and it is the piece worth being able to explain: idempotency, ordering, and transactional rollback in about a hundred lines.
- This feature ships with **no migration**, which is evidence spec 0002 designed the schema correctly rather than optimistically.

**Negative / tradeoffs**:
- The trial length lives in the Stripe dashboard, not the repository. Nobody reading the code can tell you it is 14 days, and changing it is an untracked change with no pull request. This was chosen deliberately for simplicity; the cost is real.
- Cancellation and card updates happen on a page you do not control and cannot style beyond Stripe's branding settings, and the agency visibly leaves your app to do them.
- After Checkout the agency can land back on `/billing` a moment before the webhook lands, and briefly see the pre subscription state. A refresh fixes it, and nothing is wrong, but it looks wrong for a second.
- Two sources of truth kept in step by webhooks is real machinery. A webhook endpoint misconfigured in the Stripe dashboard produces an app that looks fine and silently never updates.
- Pinning the API version means the pin is now a maintenance task: it will drift, and upgrading it is a deliberate piece of work rather than something that happens for free.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is required by `env()` while nothing reads it, so every deploy target must set a variable that currently does nothing.

**Neutral**:
- `src/payments/` comes into existence with this feature, and becomes the home for the Stripe conventions.
- The `subscriptions` row is written but not yet interpreted. Nothing gates on it until feature 9 lands, so subscribing changes what `/billing` says and nothing else.
- Rate limiting the two Server Actions is deliberately absent; feature 19 owns it, and the slot is already reserved in the action wrapper.

## Follow-up

- [ ] `src/payments/AGENTS.md` does not exist yet, and spec 0001's Follow-up already asks for it. Once this feature's code is real, the Stripe conventions belong there rather than in root `AGENTS.md`: the pinned API version and why, the single writer rule for `subscriptions`, the verify then ledger then apply order, the item level `current_period_end` trap, and the fact that the trial lives in the dashboard. Root `AGENTS.md` gets a one line pointer to it. `/sync` owns these files, so this is a task for `/sync` after the build, not a build task.
- [ ] `stripe-best-practices`, `stripe-integration`, `stripe-docs` and `upgrade-stripe` are installed and listed in spec 0001, but their conventions are not yet captured in any `AGENTS.md`. They belong in `src/payments/AGENTS.md` when it is written, not at root, since they are only needed when working on payments.
- [ ] Confirm the exact `apiVersion` string to pin against the Stripe dashboard at build time. The vendored `upgrade-stripe` skill shows `2026-08-26.dahlia` as current at the time of writing; treat that as a starting point to verify, not a value to copy blindly.
- [ ] Decide later whether the trial length should move from the Stripe dashboard into `STRIPE_TRIAL_DAYS`. If it is ever changed under pressure, or someone cannot answer what it is without opening Stripe, that is the signal to move it.
- [ ] The billing page's post Checkout moment is deliberately unpolished. If the webhook regularly lands slower than the redirect in production, revisit the polling option rather than living with it.
- [ ] **Nothing on the roadmap owns drift detection, and this is the gap most likely to bite.** If the webhook endpoint is misconfigured, or Stripe disables it after repeated failures, the mirror freezes silently and feature 9 then turns a stale row into a lockout for a paying agency. Feature 18 (daily cron sweeps) is the natural home: a nightly reconcile that lists active Stripe subscriptions and repairs any local row that disagrees. Worth enrolling on the scope as its own feature rather than leaving implied.
- [ ] The idempotency ledger is honestly a bounded work optimisation more than a correctness mechanism here, because applying only retrieved state through an upsert is already idempotent. It stays because spec 0001 chose it, it is cheap, and it becomes load bearing the moment a handler gains a non idempotent side effect such as sending an email. Worth remembering rather than mistaking for the thing that makes replay safe.
