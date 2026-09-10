# 0007. Subscription checkout and Stripe webhook: rationale

The reasoning behind [index.md](index.md). Not read during a build.

## Context

> ⚠️ Premise note: most of this decision was already made. [Spec 0001](../0001-stack-and-foundational-architecture/index.md) settled hosted Checkout plus the Billing Portal, the hand rolled webhook, the verify then ledger then apply order, the `subscriptions.retrieve` ordering fix, the status to access level table, and the six events to consume. [Spec 0002](../0002-data-model-and-migrations/index.md) built both tables. `eslint.config.mjs` already names `src/app/api/webhooks/stripe/route.ts` as a permitted caller of the unscoped database door. Treating this as an open design question would have relitigated settled ground. So this spec deliberately does two narrower jobs instead: it records the already made decision as a buildable feature spec, and it closes the specific gaps spec 0001 left open. Those gaps were the real work: what a member sees on the billing page, what happens when the same organization subscribes twice, what happens when `subscriptions.retrieve` fails after the ledger row is inserted, whether `past_due_since` may be overwritten, and the two Stripe API changes that would have broken the build quietly.

Money gates access in this product, so subscription state has to be both correct and available on every request. That state lives at Stripe. Asking Stripe on every request is slow, and it fails when Stripe fails, so the state has to be mirrored locally. Mirroring means webhooks, and webhooks mean duplicate deliveries, deliveries in the wrong order, and deliveries that arrive mid deploy. Getting this wrong has two failure modes and both are bad: lock out an agency that is paying, or hand the product to one that is not.

The forces that shaped the specific choices here:

**The engineer's stated goal is to demonstrate webhook engineering.** Spec 0001 turned down Clerk Billing partly for this reason. That makes "delegate the hard part" the wrong answer even where it is available, and it makes idempotency, ordering and transactional rollback the parts that must be visibly correct rather than merely working.

**The budget is real.** Stripe with fees waived on the first thousand dollars of revenue, everything else on free tiers. Nothing here may require a paid add on or a new piece of infrastructure.

**This feature is the seam between two others.** Feature 6 built the tenant context this reads from. Feature 9 will read the row this writes. A blurred boundary in either direction produces work done twice or not at all, so the seam had to be stated explicitly rather than left to whoever builds feature 9.

**The schema was designed before the code.** Spec 0002 made two choices specifically for this feature: `subscriptions.status` carries no CHECK constraint, so a Stripe status nobody has seen yet is recorded rather than rejected, and the idempotency ledger stores no payload. Both constrain how this code must behave.

## Options considered

### Option 1: Clerk Billing

Clerk has a billing product covering organization plans, seat limits and feature entitlements, and it is already the identity provider here. It would remove the webhook, the mirror table, and most of this spec.

**Pros**:
- Dramatically less code to write, own, and test. No webhook, no ledger, no ordering problem.
- Plans, entitlements and seat limits come as product features rather than something to build.
- One provider for identity and billing means one integration to keep working.

**Cons**:
- Clerk marks its billing APIs experimental and advises pinning package versions, which is a poor foundation for the one subsystem that must never be wrong.
- Plans live in Clerk rather than syncing to Stripe, moving the source of truth for money out of the payment processor and into the identity provider.
- It removes exactly the work this project exists to demonstrate.

### Option 2: Hosted Checkout and Billing Portal, hand rolled webhook mirror

The agency is redirected to Stripe's own hosted payment page, manages everything afterward in Stripe's Billing Portal, and one verified webhook route mirrors state into a single local row.

**Pros**:
- Card data never touches the app, keeping PCI scope at its lightest tier.
- Card updates, cancellation, retries and invoice history come free with the Portal.
- Subscription state is one local row, readable at page speed with no third party call in the request path.
- The hand written part is small, self contained, and exactly the interesting part.

**Cons**:
- Two sources of truth kept in step by webhooks is genuine machinery that needs its own tests.
- The agency visibly leaves the app to pay and to cancel, on pages that cannot be styled beyond Stripe's branding settings.
- A webhook endpoint misconfigured in the dashboard yields an app that looks healthy and silently never updates.

### Option 3: Stripe Elements embedded in the app

Build the payment form inside the product using Stripe's embeddable components, so the agency never leaves.

**Pros**:
- Fully controlled visual experience, consistent with the design system.
- No redirect, so no window where the agency is on someone else's page.

**Cons**:
- Widens PCI scope beyond the lightest self assessment tier, because a payment form is now served by this app.
- Cancellation, card updates and invoice history all become screens to build, and each is a place to get subscription state wrong.
- Buys visual polish at the cost of the two things that actually matter here, scope and correctness.

### Option 4: Poll Stripe instead of consuming webhooks

Drop the webhook entirely and refresh subscription state on a schedule, or on read.

**Pros**:
- No signature verification, no ledger, no ordering problem, no duplicate deliveries.
- Nothing silently breaks from a misconfigured endpoint, because there is no endpoint.

**Cons**:
- Vercel's free tier allows daily cron only, so state could be up to a day stale, which is unusable for an access gate.
- Polling on read puts a Stripe call in the request path, which is the thing the local mirror exists to avoid.
- Consumes API quota continuously to learn nothing most of the time.

## Rationale

Option 2 was already chosen in spec 0001 and survives re examination for the reasons stated there: Clerk's billing APIs are experimental, and it moves the source of truth for money away from the payment processor. Both remain true. The engineer's goal of demonstrating webhook engineering settles the remainder, and Option 4 is disqualified outright by the free tier's daily cron ceiling, which cannot support an access gate.

Option 3 deserves its own sentence, because it is the tempting one. Embedding Elements would make the payment flow feel native, and that is a real product benefit. It is refused here because it trades the two properties this feature is judged on, PCI scope and correctness of subscription state, for a visual one, and because it converts three screens Stripe already maintains into three screens with subscription state in them.

The genuinely new decisions in this spec, and why each went the way it did:

**Only `checkout.session.completed` creates the row.** It is the sole event carrying `client_reference_id`, which is the only thing binding a Stripe customer to an organization. The runner up, letting any event create the row by reading `subscription_data.metadata`, is more resilient to a missed checkout event but gives two code paths that can both create the same row. One creator and many updaters is easier to reason about and easier to test, and a missed `checkout.session.completed` is a case Stripe's own retry policy already handles.

**`past_due_since` is never overwritten.** Setting it only when null means the grace window is measured from the genuine first failure. Overwriting on each repeated `past_due` event would silently extend a paying window every time Stripe retried a card, which is the kind of bug that never surfaces in testing and costs money in production.

**The retrieve failure rolls back rather than falling back to the payload.** The tempting alternative is to apply the event's own snapshot when `subscriptions.retrieve` fails, keeping the webhook working while Stripe's API is degraded. That reintroduces the exact out of order risk the retrieve pattern exists to eliminate, and it does so precisely when Stripe is unhealthy and events are most likely to be delayed and reordered. Failing loudly and letting Stripe retry is correct here; the ledger and state change already commit together, so the retry gets a clean attempt.

**A member sees the billing page read only rather than being redirected.** Both are defensible. Read only wins because a member has a legitimate reason to know whether the agency is paid up, and because a redirect with no explanation is the worse experience for someone who followed a shared link. The Server Actions still refuse a member outright, so the boundary is enforced where it matters rather than by hiding a button.

**The trial length lives in the Stripe dashboard.** This one goes against the general principle that configuration belongs in the repository, and it was the engineer's call. The tradeoff is stated plainly in Consequences and carries a Follow up item: nobody reading the code can tell you the trial is 14 days, and changing it is an untracked change. The case for it is that Checkout applies a Price level trial automatically with no code at all, and there is exactly one price. The case against it will become compelling the first time someone needs to know the trial length without opening Stripe.

**`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is added despite nothing reading it.** The recommendation was to skip it, on the grounds that `env()` would then validate a variable with no consumer and every deploy target would need it set for nothing. The engineer chose to add it, matching spec 0001's configuration list literally and leaving the door open for an embedded payment surface later. The cost is small and visible, so it is recorded rather than argued further.

## Evidence: the two Stripe API changes that would have broken this quietly

A verification pass was run against Stripe's own changelog during the design conversation, because one detail was load bearing enough to be worth confirming rather than recalling.

**Confirmed.** Stripe's `2025-03-31.basil` release contains a changelog entry marked **Breaking**, under Billing: "Adds subscription item-level billing periods and removes subscription-level periods." So `current_period_start` and `current_period_end` no longer exist on the Subscription object and must be read from the subscription's items.

This matters more than it looks. Reading `subscription.current_period_end` against a current API version does not throw; it yields `undefined`. That stores a null renewal date, which means the trial end date never renders and, more seriously, the grace window feature 9 measures has nothing to measure against. It is a silent failure in the one subsystem this feature exists to get right, which is why it is called out in the build plan rather than left to be discovered.

**Also confirmed, same release, same Breaking marking**: "Invoicing resources now specify how they were generated." Invoicing objects changed how they reference the subscription that produced them, which affects both `invoice.*` handlers. The exact field path should be read from the documentation for whichever version is pinned, rather than assumed.

**Worth noting, not a problem**: the same release includes "Checkout Sessions have lower latency and new update semantics", which postpones subscription creation until after the customer completes payment. This is consistent with the design here, where `checkout.session.completed` is treated as the point at which a subscription exists.

**A third item, found by the cross check rather than by this pass**: `stripe_price_id` is item level too (`items.data[0].price.id`). Same trap, same silent failure, and the column is nullable so a wrong path stores null without complaint. There are exactly two of these fields and both are now named explicitly in the value sourcing table.

**Not confirmed, flagged rather than guessed.** The exact `apiVersion` string to pin was not verified against a live source. The vendored `upgrade-stripe` skill, published by Stripe and installed in this repository, uses `2026-08-26.dahlia` in its examples, which is a real release name in a real position (Dahlia follows Basil) and predates today. It is recorded in Follow up as a value to verify against the dashboard at build time, not to copy blindly. An unverified version string pinned into a build spec is worse than an explicit instruction to go and check.

A first research pass returned answers it then flagged as unreliable, including an internally inconsistent claim about the current version. It was discarded rather than used. The confirmations above come from Stripe's published changelog directly.

## What an independent review changed

The first draft of this spec was cross checked by a different model reading it cold. It found six load bearing gaps, all of which are now closed in `index.md`. They are recorded here because each one is a mistake worth not making twice, and because several were invisible from inside the draft:

1. **An event arriving before the row exists.** The draft said every non creating event finds its row by `stripe_customer_id`, and never said what happens when there is none. Stripe routinely delivers `customer.subscription.created` before `checkout.session.completed`, so this was not an edge case, it was a common path. The fix keeps one row creator but adds a `metadata.org_id` fallback, which is exactly the resilience the runner up option in Options considered was praised for. Worth noting that the rejected option's advantage was real and had to be partly recovered.
2. **Two acceptance criteria contradicting each other.** Choosing the billing page's button on the presence of `stripe_customer_id` meant a cancelled agency, which keeps that id, was shown a Billing Portal that cannot start a new subscription. The resubscribe criterion was therefore unreachable through the interface. The rule now keys on status.
3. **An idempotency key that did not hold.** Stripe refuses a reused key whose parameters changed, and attaching a customer changes them mid bucket. The key now covers that.
4. **A duplicate detection mechanism that could abort the transaction protecting it.** A raw unique violation poisons a Postgres transaction, so conflict-do-nothing plus an early return is not a style preference here, it is the difference between working and not. The related catch was operational: with the pool capped at one connection, calling `subscriptions.retrieve` inside the transaction would serialize the entire application on a third party round trip.
5. **The ordering fix being oversold.** Re reading state with `subscriptions.retrieve` narrows the out of order window but does not close it: two concurrent deliveries can each retrieve and then commit inverted. The row is now locked for update. The draft claimed a guarantee its design did not deliver, which is the most dangerous kind of error in a spec.
6. **No poison event rule.** Answering 500 to an event that can never succeed means Stripe retries for days and then disables the endpoint, which silently freezes the mirror. Since feature 9 turns a stale mirror into a lockout for a paying agency, this was a money losing failure mode with no owner. Unresolvable events now answer 200 and log.

The same review made a fair observation left deliberately unchanged: the idempotency ledger is closer to a bounded work optimisation than a correctness mechanism, given that applying retrieved state through an upsert is already idempotent. It stays, for the reasons in Follow up.

It also surfaced the drift detection gap now recorded in Follow up, which is the one finding this spec does not itself close, because it belongs to another feature.

One consequence of the `past_due_since` rule is worth stating plainly, since it follows from the chosen wording rather than being overlooked: a subscription moving `past_due` to `unpaid` and back to `past_due` clears the timestamp and restarts the grace clock. That is acceptable because `unpaid` is terminal in the access table and locks anyway, so the restarted window is unreachable in practice.

## References

**Project sources** (verifiable, in this repo):
- [Spec 0001](../0001-stack-and-foundational-architecture/index.md): chose hosted Checkout plus the Billing Portal, the hand rolled webhook, the webhook processing order, the `subscriptions.retrieve` ordering fix, the six events, the status to access level table, and the reasoning that turned down Clerk Billing.
- [Spec 0002](../0002-data-model-and-migrations/index.md): both tables this feature fills, and the deliberate absence of a CHECK constraint on `subscriptions.status`.
- [Spec 0003](../0003-tenant-scoping-data-access-layer/index.md): `withSystemAccess`, the named door this webhook is one of three permitted callers of, and `withTenantAction()` with its role guards.
- [Spec 0004](../0004-design-system-and-ui-foundation/index.md): the status chip, empty state and error state patterns the billing page is built from.
- `eslint.config.mjs`: already names `src/app/api/webhooks/stripe/route.ts` as a permitted importer of the unscoped door, so the route path was fixed before this spec was written.
- `.agents/skills/upgrade-stripe/SKILL.md`: Stripe's own published skill, the source of the candidate `apiVersion` value recorded in Follow up.
- Root `AGENTS.md`: the `Result` return convention for expected failures, the Zod at every trust boundary rule, and the rule that webhook handlers throw so the provider retries.

**Practices & standards**:
- Idempotency keys for operations involving money or external side effects.
- Idempotency ledger keyed on the provider's event id, committed in the same transaction as the effect it records.
- Treat a webhook event as a signal that something changed, not as the source of what it changed to.
- Verify the signature before parsing the body.
- Fail closed on an unrecognised status, which is why an unknown Stripe status maps to locked rather than to full access.
- PCI DSS SAQ A, the lightest self assessment tier, which redirecting to a hosted payment page preserves and embedding a payment form would forfeit.

**Links** (web verified):
- Stripe Basil changelog, containing both breaking entries relied on above: https://docs.stripe.com/changelog/basil
- The subscription period entry specifically: https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
- The invoicing parent field entry: https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects
- Stripe API upgrades and versioning: https://docs.stripe.com/upgrades
