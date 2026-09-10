/**
 * The one Stripe client, with its API version pinned in writing.
 *
 * The pin is the point of this file (spec 0007, build plan task 2). Stripe lets
 * an account's default version move from the dashboard, and a deployed build
 * that inherited that default would start receiving reshaped payloads with no
 * code change and no deploy. Naming the version here means the shapes this code
 * reads are the shapes it was written against.
 *
 * `satisfies Stripe.LatestApiVersion` makes the pin load bearing rather than
 * decorative: the SDK types that string as a literal, so upgrading the `stripe`
 * package to a release with a newer version fails the typecheck here. That is
 * deliberate. Spec 0007 accepts that the pin becomes a maintenance task, and a
 * compile error is a better reminder than a silent drift.
 *
 * ## The two item level fields
 *
 * Stripe's Basil release moved `current_period_end` and the price off the
 * subscription and onto its items, and reading the old paths yields `undefined`
 * rather than an error. Both were confirmed against this pinned version at
 * build time, in the SDK's own declarations:
 *
 * - `SubscriptionItem.current_period_end` exists; `Subscription` has no such
 *   field, only a list filter of the same name.
 * - `SubscriptionItem.price` is the `Price`, so `price.id` is item level too.
 * - An invoice names its subscription at
 *   `invoice.parent.subscription_details.subscription`; `Invoice` has no top
 *   level `subscription`.
 *
 * `src/payments/events.ts` parses all of these with Zod, so a future version
 * that moves them again fails loudly here instead of quietly storing null.
 */
import Stripe from "stripe";

import { env } from "@/lib/env";

/** The version every request from this app is made against. */
export const STRIPE_API_VERSION =
  "2026-08-26.dahlia" satisfies Stripe.LatestApiVersion;

let cached: Stripe | undefined;

/**
 * The shared client.
 *
 * A function rather than a module constant for the same reason `env()` is one:
 * constructing it reads a secret, and nothing that merely imports this module
 * should need one. Built once, then reused.
 */
export function stripeClient(): Stripe {
  cached ??= new Stripe(env().STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    appInfo: { name: "ClientHQ" },
  });

  return cached;
}
