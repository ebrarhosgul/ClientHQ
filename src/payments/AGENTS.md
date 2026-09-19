# Payments

## Overview

The agency subscription: starting Stripe Checkout, opening the Billing Portal, and the local `subscriptions` mirror that every screen reads instead of asking Stripe. Stripe tells the app what happened by webhook, and a nightly reconcile catches any webhook that never arrived. No client money moves through here; this is only the agency paying for the product. Settled by [spec 0007](../../docs/specs/0007-subscription-checkout-and-stripe-webhook/index.md).

## Key files

| File | Owns |
|---|---|
| `src/payments/stripe.ts` | The one Stripe client, with its API version pinned in writing |
| `src/payments/events.ts` | Zod schemas for the few values read off a Stripe payload, and nothing else |
| `src/payments/webhook.ts` | The six step webhook handler: verify, resolve the agency, re read, ledger insert, lock and apply, commit |
| `src/payments/subscription-mirror.ts` | The one place a `subscriptions` row is written: the row lock, the customer id guard and the upsert |
| `src/payments/reconcile.ts` | The `stripe_reconcile` nightly sweep. Writes through the same mirror function as the webhook |
| `src/payments/gateway.ts` | The real Stripe network calls behind the handler, kept apart so tests use a fake |
| `src/payments/start-checkout.ts`, `open-billing-portal.ts` | The two admin only Server Actions |
| `src/payments/idempotency.ts` | The Checkout idempotency key (agency, attached customer, five minute bucket) |
| `src/payments/billing-state.ts` | Turns one row into what `/billing` says and offers, from `status` |
| `src/payments/subscription-status.ts` | The status vocabulary, shared by the billing page and the access gate |
| `src/payments/fence.test.ts` | Proves one importer of the unscoped door and that only two actions may opt out of the subscription gate |
| `src/app/api/webhooks/stripe/route.ts` | The route. One of three files allowed to import `withSystemAccess` |

## Conventions

- Stripe payloads are parsed with Zod like any other input. The SDK types describe the package version; the schemas describe what this code needs, and they run.
- The webhook never trusts the event body for state. It re reads the subscription with `subscriptions.retrieve`, and does so before the transaction opens, never inside it.
- The ledger insert is conflict do nothing. A no op insert means the event was handled, so the handler commits and answers 200. Never catch a unique violation, which would poison the transaction.
- A structurally unresolvable event (no usable `org_id`, or one that names no organization) is logged and answered 200. Only transient failures return 500, so Stripe keeps retrying those and does not disable the endpoint over a poison event.
- `/billing` chooses its action from `status`, never from whether a customer id exists. An unknown status still renders.
- A webhook or reconcile analytics event fires only after its transaction commits (`src/payments/analytics.ts`).
- Only an org admin can start Checkout or open the Portal. A member sees `/billing` read only.

## Gotchas

- **Stripe's Basil release moved `current_period_end` and the price onto the subscription item.** Reading the old top level path gives `undefined`, not an error. `events.ts` parses the item level path so a change fails loudly.
- **The pinned API version is a maintenance task.** `stripe.ts` uses `satisfies Stripe.LatestApiVersion`, so upgrading the `stripe` package can fail the typecheck there on purpose.
- **The pool holds one connection.** A Stripe round trip inside a transaction would serialise the whole app.
- **`org_id` is the only thing binding a Stripe customer to an agency.** It travels as `client_reference_id` and in `subscription_data.metadata`. The mirror refuses to move an agency onto a different customer.
- **A soft deleted agency still gets its mirror row written** and a 200, because Stripe is still billing someone.
- **The reconcile writes nothing from a partial Stripe listing.** Its newest per agency rule needs the whole set.

## Agent skills

- [stripe-best-practices](../../.agents/skills/stripe-best-practices/): Checkout, Billing and webhook decisions
- [stripe-integration](../../.agents/skills/stripe-integration/) and [stripe-payments](../../.agents/skills/stripe-payments/): Checkout Sessions, subscriptions and webhook verification
- [upgrade-stripe](../../.agents/skills/upgrade-stripe/): moving the pinned API version and SDK
- [billing-automation](../../.agents/skills/billing-automation/): subscription lifecycle and dunning

## Related specs

- [Spec 0007](../../docs/specs/0007-subscription-checkout-and-stripe-webhook/index.md): Checkout, the webhook and the mirror
- [Spec 0008](../../docs/specs/0008-subscription-access-gate/index.md): the access gate that reads the mirror
- [Spec 0017](../../docs/specs/0017-daily-cron-sweeps/index.md): the Stripe reconcile

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
