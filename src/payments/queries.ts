/**
 * The one read behind `/billing` (spec 0007, AC-17).
 *
 * The page renders from this row and makes no Stripe call at all. That is what
 * keeps a Stripe outage from taking the billing page down with it, and it is
 * why the webhook bothers to mirror anything in the first place.
 *
 * Scoped by `tenantDb(ctx)` like every other read in the product, so there is no
 * path here to another agency's subscription.
 */
import { subscriptions } from "@/db/schema";
import { tenantDb, type StaffContext } from "@/db/tenant";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/**
 * The agency's subscription, or `undefined` when it has never subscribed.
 *
 * `findFirst` rather than `findById`: there is exactly one row per organization
 * (the column is unique) and the tenant predicate already names which one.
 */
export async function subscriptionForAgency(
  ctx: StaffContext,
): Promise<SubscriptionRow | undefined> {
  return tenantDb(ctx).findFirst(subscriptions);
}
