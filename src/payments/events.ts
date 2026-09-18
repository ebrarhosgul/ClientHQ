/**
 * What this app reads off a Stripe payload, and nothing else.
 *
 * The project rule is that Zod parses every input crossing into the server,
 * webhook payloads included, and Stripe is no exception just because its SDK
 * ships types. Types describe the version the package was built for; these
 * schemas describe what this code actually needs, and they run.
 *
 * That distinction earns its keep twice over here. Spec 0007 names two fields
 * that moved onto the subscription *item* in Stripe's Basil release, and warns
 * that reading the old top level path returns `undefined` and stores a silent
 * null rather than failing. Parsing turns both of those quiet failures into a
 * loud one: if `current_period_end` or the price id is not where this code
 * expects it, the webhook throws, answers 500, and Stripe retries, instead of
 * writing a row with no renewal date that nobody notices until feature 9 locks
 * a paying agency out.
 *
 * Everything here is narrow on purpose. None of it tries to model a Stripe
 * object; it models the handful of values the `subscriptions` mirror is made
 * of.
 */
import { z } from "zod";

/**
 * A reference to another Stripe object: its id, or the expanded object.
 *
 * Nothing this app sends asks for expansion, but a Stripe account can be
 * configured to expand by default, and the difference is invisible until it
 * breaks. Both spellings parse to the id.
 */
const stripeRef = z
  .union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform((value) => (typeof value === "string" ? value : value.id));

/** Seconds since the epoch, as every Stripe timestamp is. */
const stripeTimestamp = z
  .number()
  .int()
  .transform((seconds) => new Date(seconds * 1000));

/**
 * The subscription as `subscriptions.retrieve` returns it: the authoritative
 * state, and the only thing a handler is allowed to write from.
 *
 * `status` is a plain string rather than an enum on purpose, matching the
 * column: spec 0002 left the CHECK off so a status Stripe invents tomorrow is
 * recorded rather than rejected, and rejecting it here would put the failure
 * back in a different place.
 *
 * `items` is required to hold at least one entry. A subscription with no items
 * cannot exist, and being explicit is what makes the item level read safe.
 */
export const retrievedSubscription = z.object({
  id: z.string().min(1),
  customer: stripeRef,
  status: z.string().min(1),
  cancel_at_period_end: z.boolean(),
  /**
   * When Stripe created this subscription. The webhook never reads it; the
   * nightly reconcile does, to pick the newest of several subscriptions that
   * resolve to the same agency (spec 0017, AC-7).
   */
  created: stripeTimestamp,
  /**
   * When the trial ends, or null outside one. Never stored: it is passed in
   * memory to the agency's analytics group properties by the webhook and the
   * nightly reconcile (spec 0019, AC-13), and read from Stripe every time.
   */
  trial_end: stripeTimestamp.nullish(),
  metadata: z.record(z.string(), z.string()).nullish(),
  items: z.object({
    data: z
      .array(
        z.object({
          /** Item level since Basil. Reading the subscription itself gives undefined. */
          current_period_end: stripeTimestamp,
          price: z.object({ id: z.string().min(1) }),
        }),
      )
      .min(1, "a Stripe subscription always has at least one item"),
  }),
});

export type RetrievedSubscription = z.infer<typeof retrievedSubscription>;

/**
 * A completed Checkout Session, which is the only event that can bind a Stripe
 * customer to an agency: `client_reference_id` is the internal `org_id`, and no
 * other event carries it.
 */
export const checkoutSessionCompleted = z.object({
  client_reference_id: z.string().min(1).nullish(),
  customer: stripeRef.nullish(),
  subscription: stripeRef.nullish(),
});

/** A `customer.subscription.*` event. Only the id is used; state is re read. */
export const subscriptionEvent = z.object({
  id: z.string().min(1),
});

/**
 * An `invoice.*` event.
 *
 * Basil moved the subscription reference under `parent.subscription_details`.
 * An invoice with no subscription parent (a one off invoice) parses fine and
 * yields nothing to act on, which is the correct outcome rather than an error.
 */
export const invoiceEvent = z.object({
  parent: z
    .object({
      subscription_details: z
        .object({ subscription: stripeRef.nullish() })
        .nullish(),
    })
    .nullish(),
});

/**
 * Read `org_id` off a retrieved subscription's metadata.
 *
 * The fallback for an event that outran its Checkout Session (spec 0007,
 * AC-22): `startCheckout` writes the same value into
 * `subscription_data.metadata`, so a `customer.subscription.created` that
 * arrives before any row exists still knows whose it is.
 */
export function orgIdFromMetadata(
  subscription: RetrievedSubscription,
): string | undefined {
  const value = subscription.metadata?.org_id?.trim();

  return value === undefined || value === "" ? undefined : value;
}

/** The subscription item every mirrored value is read from. */
export function primaryItem(
  subscription: RetrievedSubscription,
): RetrievedSubscription["items"]["data"][number] {
  // Present by construction: the schema above requires at least one item.
  return subscription.items.data[0];
}
