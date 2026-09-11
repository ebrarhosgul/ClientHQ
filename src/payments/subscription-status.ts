/**
 * The vocabulary of a subscription's `status` column, and nothing else.
 *
 * Kept in a file that imports nothing so two readers can share it without
 * sharing each other: `billing-state.ts` turns a status into words for
 * `/billing`, and `src/access/level.ts` turns it into an access level (spec
 * 0008). The gate must not import UI types, and the billing page must not
 * import the gate, so the list they both need lives here between them.
 */

/**
 * Stripe's subscription statuses, as the pinned API version documents them.
 * Exhaustive over the SDK's union. The column carries no CHECK constraint on
 * purpose (spec 0002), so a status Stripe invents tomorrow is recorded rather
 * than rejected, and every reader has to cope with one outside this list.
 */
export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Narrow the column's bare `string` to the statuses this build knows. */
export function isKnownStatus(status: string): status is SubscriptionStatus {
  return (SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}
